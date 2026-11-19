
import argparse
import csv
import json
import random
import re
import time
from collections import Counter, defaultdict
from pathlib import Path


OUTCOME_TO_VERDICT = {
    "Success": "GO",
    "Partial Success": "CONDITIONAL GO",
    "Failure": "NO-GO",
}

VERDICTS = ["GO", "CONDITIONAL GO", "NO-GO"]


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def prepare_split(args):
    source_path = Path(args.source)
    output_dir = Path(args.output_dir)
    train_dir = output_dir / "knowledge_base_train"
    eval_path = output_dir / "eval_cases.json"
    train_path = train_dir / "train_decisions.json"

    records = load_json(source_path)
    usable_records = [
        record for record in records
        if record.get("Outcome") in OUTCOME_TO_VERDICT
    ]

    if len(usable_records) < 2:
        raise ValueError(
            "At least two records with recognized outcomes are required."
        )

    rng = random.Random(args.seed)
    rng.shuffle(usable_records)

    eval_size = min(args.eval_size, len(usable_records) - 1)
    if eval_size < 1:
        raise ValueError("Evaluation size must be at least 1.")

    eval_records = usable_records[:eval_size]
    train_records = usable_records[eval_size:]

    write_json(train_path, train_records)
    write_json(eval_path, eval_records)

    print("Prepared evaluation split")
    print(f"Training records: {len(train_records)} -> {train_path}")
    print(f"Evaluation records: {len(eval_records)} -> {eval_path}")
    print()
    print("Next build the evaluation vector database:")
    print("$env:KNOWLEDGE_BASE_DIR='evaluation/knowledge_base_train'")
    print("$env:CHROMA_DB_PATH='./chroma_db_eval'")
    print("python build_db.py")


def make_question(record):
    problem = record.get("Problem_Statement", "").strip()
    goal = record.get("Business_Goal", "").strip()
    market = record.get("Market_Condition", "").strip()
    economic = record.get("Economic_Environment", "").strip()
    competitors = record.get("Competitor_Situation", "").strip()
    customers = record.get("Customer_Segment", "").strip()
    decision = record.get("Decision_Taken", "").strip()

    financials = (
        f"Financials: Budget available: "
        f"{record.get('Budget_Available', 'unknown')}. "
        f"Revenue before decision: "
        f"{record.get('Revenue_Before_Decision', 'unknown')}. "
        f"Monthly burn rate: {record.get('Burn_Rate', 'unknown')}. "
        f"Cash runway: {record.get('Cash_Runway', 'unknown')} months."
    )

    parts = []

    if problem:
        parts.append(f"Problem: {problem}")
    if goal:
        parts.append(f"Business Goal: {goal}")
    if market or economic:
        parts.append(f"Market & Economic Context: {market}, {economic}")
    if competitors:
        parts.append(f"Competitor Situation: {competitors}")
    if customers:
        parts.append(f"Customer Segment: {customers}")

    parts.append(financials)

    if decision:
        parts.append(f"\nDecision being considered: {decision}")

    parts.append("Should we go ahead with this decision?")

    return "\n".join(parts)


def parse_verdict(text):
    if not text:
        return "UNPARSED"

    match = re.search(
        r"VERDICT\s*:\s*\[?\s*(CONDITIONAL\s+GO|NO\s*-?\s*GO|GO)",
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        match = re.search(
            r"\b(CONDITIONAL\s+GO|NO\s*-?\s*GO|GO)\b",
            text,
            flags=re.IGNORECASE,
        )

    if not match:
        return "UNPARSED"

    verdict = re.sub(r"\s+", " ", match.group(1).upper()).strip()
    return verdict.replace("NO GO", "NO-GO")


def parse_confidence(text):
    if not text:
        return None

    match = re.search(
        r"CONFIDENCE(?:\s*SCORE)?\s*:\s*\[?\s*(\d{1,3})\s*%?",
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        return None

    value = int(match.group(1))

    if value > 100:
        return None

    return value


def calculate_classification_metrics(results):
    confusion = {
        actual: Counter()
        for actual in VERDICTS
    }

    for result in results:
        actual = result["expected_verdict"]
        predicted = result["predicted_verdict"]

        if actual in VERDICTS:
            confusion[actual][predicted] += 1

    class_metrics = {}
    total_support = 0
    weighted_precision = 0.0
    weighted_recall = 0.0
    weighted_f1 = 0.0
    macro_precision = 0.0
    macro_recall = 0.0
    macro_f1 = 0.0

    for label in VERDICTS:
        true_positive = confusion[label][label]

        false_positive = sum(
            confusion[actual][label]
            for actual in VERDICTS
            if actual != label
        )

        support = sum(confusion[label].values())
        false_negative = support - true_positive

        precision = (
            true_positive / (true_positive + false_positive)
            if true_positive + false_positive else 0.0
        )

        recall = (
            true_positive / support
            if support else 0.0
        )

        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall else 0.0
        )

        class_metrics[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "support": support,
        }

        macro_precision += precision
        macro_recall += recall
        macro_f1 += f1

        total_support += support
        weighted_precision += precision * support
        weighted_recall += recall * support
        weighted_f1 += f1 * support

    number_of_classes = len(VERDICTS)

    return {
        "per_class": class_metrics,
        "macro_precision": round(macro_precision / number_of_classes, 4),
        "macro_recall": round(macro_recall / number_of_classes, 4),
        "macro_f1": round(macro_f1 / number_of_classes, 4),
        "weighted_precision": round(
            weighted_precision / total_support, 4
        ) if total_support else 0.0,
        "weighted_recall": round(
            weighted_recall / total_support, 4
        ) if total_support else 0.0,
        "weighted_f1": round(
            weighted_f1 / total_support, 4
        ) if total_support else 0.0,
        "confusion_matrix": {
            actual: dict(predictions)
            for actual, predictions in confusion.items()
        },
    }


def calculate_calibration(results, number_of_bins=10):
    calibration_cases = [
        result for result in results
        if result["confidence"] is not None
    ]

    if not calibration_cases:
        return {
            "brier_score": None,
            "ece": None,
            "calibration_cases": 0,
            "ece_bins": number_of_bins,
        }

    brier_total = 0.0
    bins = [
        {"count": 0, "confidence_sum": 0.0, "correct_sum": 0}
        for _ in range(number_of_bins)
    ]

    for result in calibration_cases:
        confidence = result["confidence"] / 100.0
        observed_correctness = 1 if result["correct"] else 0

        brier_total += (
            confidence - observed_correctness
        ) ** 2

        bin_index = min(
            int(confidence * number_of_bins),
            number_of_bins - 1,
        )

        bins[bin_index]["count"] += 1
        bins[bin_index]["confidence_sum"] += confidence
        bins[bin_index]["correct_sum"] += observed_correctness

    brier_score = brier_total / len(calibration_cases)
    ece = 0.0
    bin_details = []

    for index, bin_data in enumerate(bins):
        count = bin_data["count"]
        lower = index / number_of_bins
        upper = (index + 1) / number_of_bins

        if count:
            average_confidence = bin_data["confidence_sum"] / count
            accuracy = bin_data["correct_sum"] / count

            ece += (
                count / len(calibration_cases)
            ) * abs(average_confidence - accuracy)
        else:
            average_confidence = None
            accuracy = None

        bin_details.append({
            "range": f"{lower:.1f}-{upper:.1f}",
            "count": count,
            "average_confidence": round(average_confidence, 4)
            if average_confidence is not None else None,
            "accuracy": round(accuracy, 4)
            if accuracy is not None else None,
        })

    return {
        "brier_score": round(brier_score, 4),
        "ece": round(ece, 4),
        "calibration_cases": len(calibration_cases),
        "ece_bins": number_of_bins,
        "calibration_bin_details": bin_details,
    }


def run_evaluation(args):
    from main import run_second_opinion

    records = load_json(Path(args.eval_cases))

    if args.limit:
        records = records[:args.limit]

    if not records:
        raise ValueError("No evaluation cases were found.")

    results = []
    overall_start = time.perf_counter()

    for index, record in enumerate(records, start=1):
        expected = OUTCOME_TO_VERDICT.get(
            record.get("Outcome"), "UNKNOWN"
        )
        question = make_question(record)

        print("=" * 80)
        print(
            f"Case {index}/{len(records)}: "
            f"{record.get('Decision_ID')} | expected={expected}"
        )

        case_start = time.perf_counter()

        try:
            answer = run_second_opinion(question)
            predicted = parse_verdict(answer)
            confidence = parse_confidence(answer)
            error = ""
        except Exception as exc:
            answer = ""
            predicted = "ERROR"
            confidence = None
            error = str(exc)

        case_runtime = time.perf_counter() - case_start
        correct = predicted == expected

        results.append({
            "decision_id": record.get("Decision_ID", ""),
            "company": record.get("Company", ""),
            "domain": record.get("Domain", ""),
            "year": record.get("Year", ""),
            "category": record.get("Decision_Category", ""),
            "outcome": record.get("Outcome", ""),
            "expected_verdict": expected,
            "predicted_verdict": predicted,
            "correct": correct,
            "confidence": confidence,
            "runtime_seconds": round(case_runtime, 3),
            "error": error,
            "question": question,
            "model_answer": answer,
        })

        print(
            f"predicted={predicted} confidence={confidence} "
            f"correct={correct} runtime={case_runtime:.2f}s"
        )

        if error:
            print(f"error={error}")

    total_runtime = time.perf_counter() - overall_start

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    csv_path = output_dir / "evaluation_results.csv"
    json_path = output_dir / "evaluation_results.json"
    summary_path = output_dir / "evaluation_summary.json"

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = list(results[0].keys())
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    write_json(json_path, results)

    total_cases = len(results)
    correct_count = sum(
        1 for result in results if result["correct"]
    )

    confidence_values = [
        result["confidence"] for result in results
        if result["confidence"] is not None
    ]

    correct_confidence = [
        result["confidence"] for result in results
        if result["correct"] and result["confidence"] is not None
    ]

    incorrect_confidence = [
        result["confidence"] for result in results
        if not result["correct"] and result["confidence"] is not None
    ]

    classification = calculate_classification_metrics(results)
    calibration = calculate_calibration(results)

    runtimes = [result["runtime_seconds"] for result in results]

    summary = {
        "total_cases": total_cases,
        "correct_cases": correct_count,
        "incorrect_cases": total_cases - correct_count,
        "accuracy": round(correct_count / total_cases, 4),
        "average_confidence": round(
            sum(confidence_values) / len(confidence_values), 2
        ) if confidence_values else None,
        "average_confidence_when_correct": round(
            sum(correct_confidence) / len(correct_confidence), 2
        ) if correct_confidence else None,
        "average_confidence_when_incorrect": round(
            sum(incorrect_confidence) / len(incorrect_confidence), 2
        ) if incorrect_confidence else None,
        "average_runtime_seconds": round(
            sum(runtimes) / len(runtimes), 3
        ) if runtimes else 0.0,
        "total_evaluation_runtime_seconds": round(total_runtime, 3),
        **classification,
        **calibration,
    }

    write_json(summary_path, summary)

    print("=" * 80)
    print(f"Accuracy: {summary['accuracy'] * 100:.2f}%")
    print(f"Correct cases: {correct_count}/{total_cases}")
    print(f"Macro F1: {summary['macro_f1']}")
    print(f"Weighted F1: {summary['weighted_f1']}")
    print(f"Average confidence: {summary['average_confidence']}")
    print(f"Brier Score: {summary['brier_score']}")
    print(f"ECE: {summary['ece']}")
    print(
        "Average runtime per case: "
        f"{summary['average_runtime_seconds']} seconds"
    )
    print(
        "Total evaluation runtime: "
        f"{summary['total_evaluation_runtime_seconds']} seconds"
    )
    print(f"Results CSV: {csv_path}")
    print(f"Results JSON: {json_path}")
    print(f"Summary JSON: {summary_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate the SecondOpinion decision model."
    )

    subparsers = parser.add_subparsers(
        dest="command",
        required=True,
    )

    prepare_parser = subparsers.add_parser(
        "prepare",
        help="Create train/evaluation split.",
    )

    prepare_parser.add_argument(
        "--source",
        default="knowledge_base/entrepreneurial_decisions.json",
        help="Path to the full entrepreneurial decisions JSON dataset.",
    )
    prepare_parser.add_argument("--output-dir", default="evaluation")
    prepare_parser.add_argument("--eval-size", type=int, default=100)
    prepare_parser.add_argument("--seed", type=int, default=42)
    prepare_parser.set_defaults(func=prepare_split)

    run_parser = subparsers.add_parser(
        "run",
        help="Run model evaluation on holdout cases.",
    )

    run_parser.add_argument(
        "--eval-cases",
        default="evaluation/eval_cases.json",
    )
    run_parser.add_argument(
        "--output-dir",
        default="evaluation/results",
    )
    run_parser.add_argument("--limit", type=int, default=0)
    run_parser.set_defaults(func=run_evaluation)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
