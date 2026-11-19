# SecondOpinion – AI Debate Decision System

## 🚀 Overview
**SecondOpinion** is a multi-agent AI system designed to help founders and entrepreneurs make informed decisions by simulating a structured, adversarial debate grounded in startup knowledge.

Instead of providing a generic answer, the system:
- Generates strong arguments **FOR** a decision
- Generates critical arguments **AGAINST** it
- Identifies **blind spots** and formulates targeted follow-up questions
- Conducts a second round of debate specifically addressing the blind spots
- Issues a **definitive verdict** (`GO`, `NO-GO`, or `CONDITIONAL GO`) with confidence scores and actionable next steps

The workflow is orchestrated using **LangGraph**, with **ChromaDB** for RAG document retrieval and **Ollama (Llama 3)** for local LLM inference.

---

## 🧠 Architecture
The system employs 4 specialized AI agents:
1. **FOR Agent** – Acts as a passionate startup advocate supporting the decision.
2. **AGAINST Agent** – Acts as a ruthless devil's advocate challenging the decision.
3. **Questioner Agent** – Analyzes gaps and extracts critical blind spots.
4. **Judge Agent** – Evaluates all rounds and delivers a grounded, structured verdict.

```
User Question
     ↓
Initial Retrieval
     ↓
Round 1 – FOR Agent
     ↓
Round 1 – AGAINST Agent
     ↓
Questioner Agent – Blind Spot Detection & Secondary Retrieval
     ↓
Round 2 – FOR Agent on Blind Spots
     ↓
Round 2 – AGAINST Agent on Blind Spots
     ↓
Judge Agent – Final Verdict
```

---

## 📂 Project Structure
```
SecondOpinion-LangG/
│
├── agents.py                     # Agent logic, system prompts, LLM & ChromaDB calls
├── main.py                       # LangGraph state graph and interactive CLI entrypoint
├── build_db.py                   # Ingests JSON/TXT datasets into ChromaDB vector store
├── evaluate_model.py             # Evaluation split preparation, metrics calculation & benchmark runner
├── requirements.txt              # Project dependencies
├── README.md                     # Documentation
│
├── knowledge_base/               # Knowledge base documents and datasets
│   ├── entrepreneurial_decisions.json
│   └── food_delivery.txt
│
└── evaluation/                   # Evaluation dataset splits and output reports
    ├── eval_cases.json
    ├── knowledge_base_train/
    └── results/
```

---

## ⚙️ Setup Instructions

### 1. Clone the repository
```bash
git clone https://github.com/AgamjotSingh21/SecondOpinion-LangG.git
cd SecondOpinion-LangG
```

### 2. Create and activate a virtual environment
```bash
# Windows (PowerShell)
python -m venv venv
venv\Scripts\activate

# Linux / macOS
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies
```bash
python -m pip install -r requirements.txt
```

### 4. Setup and start Ollama
Download and install Ollama from [ollama.com](https://ollama.com).
Pull and run the Llama 3 model:
```bash
ollama run llama3
```

### 5. Build the Knowledge Vector Database
Build the ChromaDB vector database from the knowledge base:
```bash
python build_db.py
```

---

## ▶️ Running the Debate System

Run the interactive CLI:
```bash
python main.py
```

### Example Question:
> *Should I start a food delivery startup in Ludhiana?*

---

## Model Evaluation

### 1. Overview

SecondOpinion is evaluated using a held-out dataset of 100 entrepreneurial decision cases. The original dataset contains 5,000 records, divided into:

- **Knowledge Base:** 4,900 records used for retrieval during evaluation.
- **Evaluation Set:** 100 records used to test the system's recommendations.

The evaluation records are excluded from the evaluation knowledge base to reduce direct retrieval of test cases. Each evaluation case is passed through the complete SecondOpinion multi-agent pipeline, and the final Judge verdict is compared with the expected verdict derived from the historical outcome.

### 2. Evaluation Labels

Historical outcomes are mapped to recommendation labels as follows:

| Historical Outcome | Expected Verdict |
|---|---|
| Success | GO |
| Partial Success | CONDITIONAL GO |
| Failure | NO-GO |

These labels provide a reference for measuring agreement with historical outcomes. They are proxies, not definitive ground truth for the quality of a business decision or the future success of a startup.

### 3. Prepare the Evaluation Dataset

Run the following command from the project root with the virtual environment activated:

```powershell
python evaluate_model.py prepare --source knowledge_base/entrepreneurial_decisions.json --eval-size 100
```

This creates the evaluation split:

- `evaluation/knowledge_base_train/train_decisions.json`
- `evaluation/eval_cases.json`

The split uses a fixed random seed to make the preparation reproducible.

### 4. Build a Separate Evaluation Vector Database

Use a separate ChromaDB directory so that the original knowledge base is not overwritten.

Run these commands in the same PowerShell terminal:

```powershell
$env:KNOWLEDGE_BASE_DIR="evaluation/knowledge_base_train"
$env:CHROMA_DB_PATH="./chroma_db_eval"
python build_db.py
```

The script builds the evaluation knowledge base using the 4,900 training records. The 100 evaluation cases are kept separate.

**Important:** Do not set `CHROMA_DB_PATH` to the original `./chroma_db` when rebuilding the database, because the build script resets its collection.

### Activating the Virtual Environment in PowerShell (In Case of Error)

If PowerShell displays an error stating that running scripts is disabled when activating the virtual environment, follow these steps.

**Step 1: Allow scripts for the current terminal session only**

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

This change applies only to the current PowerShell session and does not permanently change the system-wide execution policy.

**Step 2: Activate the virtual environment**

From the project root directory, run:

```powershell
venv\Scripts\activate
```

Once activated, `(venv)` should appear at the beginning of the terminal prompt.

**Alternative: Use Command Prompt (CMD)**

If you prefer not to change the PowerShell execution policy, open a CMD terminal in VS Code and run:

```cmd
venv\Scripts\activate.bat
```

**Note:** If the virtual environment is located in a different directory, adjust the activation path accordingly.

### 5. Run the Evaluation

First, test a small number of cases:

```powershell
python evaluate_model.py run --eval-cases evaluation/eval_cases.json --limit 3
```

After verifying that the pipeline works, run all 100 cases:

```powershell
python evaluate_model.py run --eval-cases evaluation/eval_cases.json --limit 100
```

Keep the same terminal session open so that the evaluation environment variables remain set. The full run may take several hours because each case requires multiple agent and LLM calls.

### 6. Evaluation Metrics

The evaluation script calculates the following metrics:

- **Accuracy:** Proportion of cases where the predicted verdict matches the expected verdict.
- **Per-class Precision:** Proportion of predictions for a verdict class that are correct.
- **Per-class Recall:** Proportion of actual cases of a verdict class that are identified correctly.
- **Per-class F1-score:** Harmonic mean of precision and recall for each verdict class.
- **Macro F1-score:** Average F1-score across the three verdict classes, treating each class equally.
- **Weighted F1-score:** Average F1-score weighted by the number of actual cases in each class.
- **Confusion Matrix:** Shows the distribution of actual versus predicted verdicts.
- **Average Confidence:** Mean confidence reported by the Judge across evaluation cases.
- **Confidence by Correctness:** Compares average reported confidence for correct and incorrect predictions.
- **Brier Score:** Measures the squared error between reported confidence and binary correctness, where correctness is represented as 1 and incorrectness as 0. Lower values are better.
- **Expected Calibration Error (ECE):** Measures the weighted difference between reported confidence and observed correctness across confidence bins. Lower values indicate better calibration.
- **Average Runtime per Case:** Mean time taken to evaluate a single case.
- **Total Evaluation Runtime:** Total time recorded for the evaluation run.

The Brier Score and ECE are calculated against binary correctness, not the probability that a startup will succeed. They measure whether the Judge's reported confidence corresponds to the correctness of its mapped verdict.

### 7. Evaluation Outputs

The script saves results under `evaluation/results/`:

- `evaluation_results.csv` — case-level evaluation results.
- `evaluation_results.json` — detailed results in JSON format.
- `evaluation_summary.json` — aggregate metrics, per-class metrics, confusion matrix, and calibration information.

Check that `total_cases` in the summary JSON is 100 after the full run.

### 8. Generate Evaluation Visualizations

Run the plotting script from the project root:

```powershell
python plot_results.py
```

The script reads `evaluation/results/evaluation_summary.json` and, where applicable, `evaluation/results/evaluation_results.csv`. It saves the following figures under `evaluation/results/plots/`:

- `confusion_matrix.png`
- `classification_metrics.png`
- `calibration_plot.png`
- `runtime.png`

Run this command again after completing the full evaluation to generate figures from the 100-case results.

### 9. Qualitative Contextual-Relevance Analysis

In addition to numerical metrics, manually examine representative outputs from six business domains:

1. Food and Restaurants
2. EdTech
3. Finance
4. Agriculture
5. Retail
6. Healthcare

Assess whether the system uses relevant retrieved evidence, identifies important risks and blind spots, considers the business context, and provides a practical recommendation. Record representative examples and limitations using the actual model outputs.

This qualitative analysis is reported separately from the coded benchmark metrics.

### 10. Evaluation Limitations

The benchmark measures agreement with verdict labels derived from historical outcomes. Historical business success or failure may depend on factors that are not


## 📋 Verdict Output Format

The Judge Agent delivers a structured verdict in the following format:

```text
============================================================
JUDGE AGENT — FINAL VERDICT
============================================================

VERDICT: [GO / CONDITIONAL GO / NO-GO]
CONFIDENCE: [0-100]%

1. EXECUTIVE SUMMARY
Brief summary of the final decision and its main reasoning.

2. KEY FINDINGS
Main supporting arguments, opposing arguments, and relevant evidence
identified during the debate.

3. BLIND SPOTS ADDRESSED
Important risks, missing information, and uncertainties identified
by the Questioner Agent and considered in the second debate round.

4. RISK ASSESSMENT
Major risks, their potential impact, and practical mitigation measures.

5. RECOMMENDED ACTIONS
Concrete next steps, including low-cost validation tests where applicable.

6. SUCCESS CRITERIA
Measurable conditions that should be met before proceeding or expanding.

7. FINAL JUSTIFICATION
Explanation of why the selected verdict is appropriate given the
available evidence, business context, and constraints.

============================================================
END OF FINAL VERDICT
============================================================
```

Confidence represents the Judge Agent's self-reported confidence in its recommendation, not a calibrated probability of business success.

---

## 🛠 Tech Stack
- **Orchestration**: LangGraph
- **Vector Database**: ChromaDB
- **Embeddings**: SentenceTransformers (`all-MiniLM-L6-v2`)
- **LLM Engine**: Ollama (Llama 3)
- **Language**: Python 3.10+
