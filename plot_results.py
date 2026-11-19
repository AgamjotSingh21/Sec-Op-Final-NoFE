
import csv
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
RESULTS_DIR = BASE_DIR / "evaluation" / "results"
SUMMARY_FILE = RESULTS_DIR / "evaluation_summary.json"
CSV_FILE = RESULTS_DIR / "evaluation_results.csv"
PLOTS_DIR = RESULTS_DIR / "plots"

CLASSES = ["GO", "CONDITIONAL GO", "NO-GO"]


def save_confusion_matrix(summary):
    matrix_data = summary["confusion_matrix"]

    matrix = np.zeros((3, 3), dtype=int)

    for i, actual in enumerate(CLASSES):
        for j, predicted in enumerate(CLASSES):
            matrix[i, j] = matrix_data.get(actual, {}).get(predicted, 0)

    fig, ax = plt.subplots(figsize=(7, 5))
    image = ax.imshow(matrix, cmap="Blues")

    ax.set_xticks(range(3), CLASSES, rotation=20, ha="right")
    ax.set_yticks(range(3), CLASSES)
    ax.set_xlabel("Predicted Verdict")
    ax.set_ylabel("Actual Verdict")
    ax.set_title("Confusion Matrix")

    for i in range(3):
        for j in range(3):
            ax.text(j, i, str(matrix[i, j]), ha="center", va="center")

    fig.colorbar(image, ax=ax, label="Number of Cases")
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "confusion_matrix.png", dpi=300)
    plt.close(fig)


def save_classification_metrics(summary):
    per_class = summary["per_class"]
    metrics = ["precision", "recall", "f1_score"]
    labels = ["Precision", "Recall", "F1 Score"]

    values = [
        [per_class[c][metric] for metric in metrics]
        for c in CLASSES
    ]

    x = np.arange(len(CLASSES))
    width = 0.25

    fig, ax = plt.subplots(figsize=(9, 5))

    for i, label in enumerate(labels):
        bars = ax.bar(
            x + (i - 1) * width,
            [row[i] for row in values],
            width,
            label=label
        )
        ax.bar_label(bars, fmt="%.2f", padding=2, fontsize=8)

    ax.set_xticks(x, CLASSES)
    ax.set_ylim(0, 1.15)
    ax.set_ylabel("Score")
    ax.set_title("Per-Class Classification Performance")
    ax.legend()
    ax.grid(axis="y", alpha=0.25)

    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "classification_metrics.png", dpi=300)
    plt.close(fig)


def save_calibration_plot(summary):
    bins = summary.get("calibration_bin_details", [])

    confidence = []
    accuracy = []
    counts = []

    for item in bins:
        if item.get("count", 0) > 0:
            confidence.append(item["average_confidence"])
            accuracy.append(item["accuracy"])
            counts.append(item["count"])

    if not confidence:
        print("Skipping calibration plot: no populated bins.")
        return

    fig, ax = plt.subplots(figsize=(7, 5))

    ax.plot([0, 1], [0, 1], "--", label="Perfect Calibration")
    ax.plot(confidence, accuracy, marker="o", label="Observed Calibration")

    for x, y, count in zip(confidence, accuracy, counts):
        ax.annotate(f"n={count}", (x, y), xytext=(5, 5),
                    textcoords="offset points", fontsize=8)

    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Average Reported Confidence")
    ax.set_ylabel("Observed Accuracy")
    ax.set_title("Confidence Calibration")
    ax.legend()
    ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "calibration_plot.png", dpi=300)
    plt.close(fig)


def save_runtime_plot(summary):
    runtimes = []

    if CSV_FILE.exists():
        with CSV_FILE.open("r", newline="", encoding="utf-8-sig") as file:
            reader = csv.DictReader(file)

            if reader.fieldnames:
                runtime_column = next(
                    (name for name in reader.fieldnames
                     if "runtime" in name.lower()),
                    None
                )

                if runtime_column:
                    for row in reader:
                        try:
                            value = float(row[runtime_column])
                            if np.isfinite(value) and value >= 0:
                                runtimes.append(value)
                        except (ValueError, TypeError):
                            pass

    if runtimes:
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.hist(runtimes, bins="auto", edgecolor="black")
        ax.set_xlabel("Runtime per Case (seconds)")
        ax.set_ylabel("Number of Cases")
        ax.set_title("Evaluation Runtime Distribution")
        ax.grid(axis="y", alpha=0.25)
    else:
        average = summary.get("average_runtime_seconds", 0)

        fig, ax = plt.subplots(figsize=(7, 4))
        ax.bar(["Average Runtime"], [average])
        ax.set_ylabel("Seconds")
        ax.set_title("Average Runtime per Case")
        ax.text(0, average, f" {average:.1f}s", ha="center", va="bottom")

    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "runtime.png", dpi=300)
    plt.close(fig)


def main():
    if not SUMMARY_FILE.exists():
        raise FileNotFoundError(
            f"Summary not found: {SUMMARY_FILE}\n"
            "Run the evaluation before generating plots."
        )

    with SUMMARY_FILE.open("r", encoding="utf-8") as file:
        summary = json.load(file)

    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    save_confusion_matrix(summary)
    save_classification_metrics(summary)
    save_calibration_plot(summary)
    save_runtime_plot(summary)

    print(f"Charts saved to: {PLOTS_DIR}")
    print("Generated charts:")
    for path in sorted(PLOTS_DIR.glob("*.png")):
        print(f" - {path.name}")


if __name__ == "__main__":
    main()
