import requests
import os
import re
import chromadb
from sentence_transformers import SentenceTransformer


CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
chroma = chromadb.PersistentClient(path=CHROMA_DB_PATH)
collection = chroma.get_or_create_collection("startup_knowledge")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

def embed_text(text):
    return embed_model.encode(text).tolist()

def search_db(query, n=5):
    query_vector = embed_text(query)
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=n
    )
    return results["documents"][0]

def call_llm(system_prompt, user_message):
    url = "http://localhost:11434/api/generate"
    
    prompt = f"{system_prompt}\n\n{user_message}"
    
    response = requests.post(url, json={
        "model": "llama3",
        "prompt": prompt,
        "stream": False
    })
    
    return response.json()["response"]

def clean_and_ensure_verdict(text):
    if not text:
        return (
            "VERDICT: NO-GO\n"
            "CONFIDENCE: 85%\n\n"
            "DECIDING FACTOR:\n"
            "Insufficient information provided to validate the decision.\n\n"
            "REASONING:\n"
            "Without reliable business metrics and market validation, moving forward presents disproportionate risk.\n\n"
            "STRONGEST OPPOSING POINT:\n"
            "The opportunity could be explored if critical market data becomes available.\n\n"
            "UNRESOLVED BLIND SPOTS:\n"
            "1. Target customer willingness to pay.\n"
            "2. Sustainable unit economics.\n\n"
            "NEXT ACTION:\n"
            "Conduct preliminary customer interviews to validate demand."
        )

    # 1. Filter unwanted metadata lines
    filtered_lines = []
    for line in text.splitlines():
        trimmed = line.strip()
        if re.match(r"^(?:Decision\s*ID|Domain|Company(?:\s*Stage)?|Year|Stage|Growth|Decision\s*Category)\s*:\s*", trimmed, flags=re.IGNORECASE):
            continue
        filtered_lines.append(line)
    
    cleaned = "\n".join(filtered_lines).strip()

    # 2. Extract verdict (GO / NO-GO / CONDITIONAL GO)
    verdict_match = re.search(
        r"(?:\*{0,3}|#*\s*)VERDICT(?:\*{0,3})\s*:\s*\[?(?:\*{0,2})(CONDITIONAL\s+GO|NO\s*-?\s*GO|GO)(?:\*{0,2})\]?",
        cleaned,
        flags=re.IGNORECASE
    )
    if verdict_match:
        raw_v = re.sub(r"\s+", " ", verdict_match.group(1).upper()).strip()
        verdict_str = raw_v.replace("NO GO", "NO-GO")
    else:
        kw_match = re.search(r"\b(CONDITIONAL\s+GO|NO\s*-?\s*GO|GO)\b", cleaned, flags=re.IGNORECASE)
        if kw_match:
            raw_v = re.sub(r"\s+", " ", kw_match.group(1).upper()).strip()
            verdict_str = raw_v.replace("NO GO", "NO-GO")
        else:
            verdict_str = "NO-GO"

    # 3. Extract confidence percentage
    conf_match = re.search(
        r"(?:\*{0,3}|#*\s*)CONFIDENCE(?:\s*SCORE)?(?:\*{0,3})\s*:\s*\[?(?:\*{0,2})(\d{1,3})\s*%?(?:\*{0,2})\]?",
        cleaned,
        flags=re.IGNORECASE
    )
    if conf_match:
        conf_val = max(0, min(100, int(conf_match.group(1))))
    else:
        pct_match = re.search(r"(\d{1,3})\s*%", cleaned)
        if pct_match:
            conf_val = max(0, min(100, int(pct_match.group(1))))
        else:
            if verdict_str == "CONDITIONAL GO":
                conf_val = 75
            elif verdict_str == "NO-GO":
                conf_val = 90
            else:
                conf_val = 85

    # 4. Remove leading VERDICT / CONFIDENCE lines from body
    cleaned_body = re.sub(
        r"^(?:\s*(?:\*{0,3}|#*\s*)(?:VERDICT|CONFIDENCE(?:\s*SCORE)?)[^\n]*\n?)+",
        "",
        cleaned,
        flags=re.IGNORECASE
    ).strip()

    # 5. Clean markdown bolding and header formatting around standard sections
    sections = [
        ("DECIDING FACTOR", r"DECIDING\s*FACTOR"),
        ("REASONING", r"REASONING"),
        ("STRONGEST OPPOSING POINT", r"STRONGEST\s*OPPOSING\s*POINT"),
        ("UNRESOLVED BLIND SPOTS", r"UNRESOLVED\s*BLIND\s*SPOTS"),
        ("NEXT ACTION", r"NEXT\s*ACTION"),
    ]
    for standard_title, pattern in sections:
        cleaned_body = re.sub(
            rf"(?m)^[\s#*_]*{pattern}[\s#*_]*:\s*[\s*_]*",
            f"\n\n{standard_title}:\n",
            cleaned_body,
            flags=re.IGNORECASE
        )

    # 6. Ensure clean spacing between sections
    cleaned_body = re.sub(r"\n{3,}", "\n\n", cleaned_body).strip()

    final_output = f"VERDICT: {verdict_str}\nCONFIDENCE: {conf_val}%\n\n{cleaned_body}"
    return final_output

def for_agent(question, docs):
    context = "\n\n".join(docs[:3])
    system = """You are a passionate startup advocate. 
Argue as strongly as possible FOR the user's decision.
Use the provided documents as evidence.
Do NOT mention metadata fields like Year, Company, ID, Domain, or Stage.
Never hedge. Never be diplomatic. Take a strong position."""
    
    user = f"""Decision: {question}

Knowledge documents:
{context}

Argue strongly FOR this decision."""
    
    return call_llm(system, user)

def against_agent(question, docs):
    context = "\n\n".join(docs[:3])
    system = """You are a ruthless devil's advocate.
Argue as strongly as possible AGAINST the user's decision.
Use the provided documents as evidence.
Do NOT mention metadata fields like Year, Company, ID, Domain, or Stage.
Never hedge. Never be diplomatic. Take a strong position."""
    
    user = f"""Decision: {question}

Knowledge documents:
{context}

Argue strongly AGAINST this decision."""
    
    return call_llm(system, user)

def questioner_agent(question, for_output, against_output):
    system = """You are an expert at finding blind spots in startup decisions.
Read both arguments and identify what BOTH agents missed.
Then generate exactly 3 sharp follow-up questions.
Do NOT mention metadata fields like Year, Company, ID, Domain, or Stage.
These questions should expose the most critical gaps."""
    
    user = f"""Original question: {question}

FOR argued: {for_output}

AGAINST argued: {against_output}

Identify blind spots and generate 3 follow-up questions."""
    
    blind_spots = call_llm(system, user)
    search_query = f"{question} {blind_spots[:200]}"
    new_docs = search_db(search_query, n=3)
    
    return blind_spots, new_docs

def for_agent_round2(question, blind_spots, docs):
    context = "\n\n".join(docs[:4])
    system = """You are a passionate startup advocate in Round 2 of a debate.
Address the blind spots and follow-up questions raised by the Questioner.
Defend the user's decision vigorously against these criticisms.
Use the provided documents as evidence.
Do NOT mention metadata fields like Year, Company, ID, Domain, or Stage.
Never hedge. Never be diplomatic. Take a strong, confident position in favor of the decision."""

    user = f"""Original Decision Question: {question}

Blind spots and follow-up questions to address:
{blind_spots}

Knowledge documents:
{context}

Address the blind spots and argue strongly FOR the decision in context of the original question."""

    return call_llm(system, user)

def against_agent_round2(question, blind_spots, docs):
    context = "\n\n".join(docs[:4])
    system = """You are a ruthless devil's advocate in Round 2 of a debate.
Exploit the blind spots and follow-up questions raised by the Questioner.
Attack the user's decision by pressing hard on these critical vulnerabilities and risks.
Use the provided documents as evidence.
Do NOT mention metadata fields like Year, Company, ID, Domain, or Stage.
Never hedge. Never be diplomatic. Take a strong, uncompromising position against the decision."""

    user = f"""Original Decision Question: {question}

Blind spots and follow-up questions to exploit:
{blind_spots}

Knowledge documents:
{context}

Exploit the blind spots and argue strongly AGAINST the decision in context of the original question."""

    return call_llm(system, user)


def judge_agent(question, r1_for, r1_against,
                blind_spots, r2_for, r2_against, docs):

    system = """You are the final Judge evaluating an entrepreneurial decision.

Your task is to evaluate ONLY the business decision described in the user's original question.

VERDICT RULES:
- GO: The decision is supported by clear evidence of viability and manageable risks.
- NO-GO: The decision is not viable based on the available evidence.
- CONDITIONAL GO: The decision may be viable if specific conditions are met first.

STRICT CONTEXT RULES:
1. The original question is the authoritative description of the user's business.
2. Never replace the user's business, location, customers, budget, finances,
   or proposed decision with details from another company or historical case.
3. The debate arguments may contain irrelevant or inaccurate historical details.
   Do not repeat those details as facts about the user's business.
4. Do not introduce company names, financial figures, outcomes, or decisions
   from historical cases unless they are explicitly relevant and clearly
   identified as comparisons.
5. Base your verdict on the original question, both rounds of arguments,
   and the blind spots identified.
6. Do not assume unsupported market statistics are true.
7. The final recommendation must agree with the verdict.
8. If the evidence is insufficient to make a confident decision, explain
   the uncertainty and state what must be validated before investing.

EVIDENCE AND DECISION QUALITY RULES:

1. Do not claim that a market is growing, competition is limited,
   or an opportunity exists unless supported by the provided evidence.
   If evidence is missing, explicitly state that it is unknown.

2. Do not recommend expensive infrastructure or expansion when the user
   has a limited budget. Prefer low-cost validation before investment.

3. Make the verdict depend on concrete viability conditions:
   customer demand, restaurant willingness to partner, contribution
   margin per order, delivery cost, customer acquisition cost,
   and repeat orders.

4. For CONDITIONAL GO, state measurable conditions that must be met
   before committing significant capital. Do not invent numerical
   targets when the available evidence cannot justify them.

5. Every recommendation must address a specific risk in the original
   question. Avoid generic advice such as "conduct market research"
   unless you specify what must be validated and how.

6. Distinguish facts supplied by the user, evidence from documents,
   and assumptions. Never present assumptions as established facts.
   
ACTIONABLE DECISION REQUIREMENTS:
- Convert each major risk into a practical test, the metric to measure, and how the result should affect the decision.
- Prioritize small, low-cost pilot tests before hiring staff, expanding operations, or making major investments.
- Explicitly respect the user's stated constraints, including limited budget and no heavy discounts.
- Define the conditions under which the recommendation should change from CONDITIONAL GO to GO or NO-GO.
- Do not invent market statistics, numerical targets, or evidence that was not provided or retrieved.
- Avoid generic recommendations such as "conduct thorough market research" unless you specify exactly what to investigate and how.
- Keep the response specific to the user's business and avoid repeating the same risk across multiple sections.
SPECIFICITY REQUIREMENTS:

- Do not merely repeat that more research is needed.
- For every major risk, specify what the founder should measure,
  how to validate it, and how the result affects the decision.
- Prioritize low-cost tests before significant investment.
- Address the user's stated constraints, especially the limited budget
  and inability to offer heavy discounts.
- Avoid introducing new risks, such as regulatory hurdles, unless
  they are relevant and supported by the scenario or evidence.
- Give at least three concrete decision criteria, but do not invent
  numerical thresholds without supporting evidence.
- Keep the final answer focused on this specific business.

OUTPUT FORMAT:
The first line must be: VERDICT: GO, NO-GO, or CONDITIONAL GO
The second line must be: CONFIDENCE: [0-100]%

Then provide these sections:
DECIDING FACTOR:
REASONING:
STRONGEST OPPOSING POINT:
UNRESOLVED BLIND SPOTS:
NEXT ACTION:

Do not output a historical case summary or a second, conflicting verdict.
Do not call the decision a "success" or "failure"; evaluate whether the
user should proceed with the proposed decision."""

    user = f"""ORIGINAL BUSINESS QUESTION:
{question}

ROUND 1 — FOR:
{r1_for}

ROUND 1 — AGAINST:
{r1_against}

BLIND SPOTS:
{blind_spots}

ROUND 2 — FOR:
{r2_for}

ROUND 2 — AGAINST:
{r2_against}

Evaluate the original business question only. Give one consistent verdict
and a recommendation that agrees with it."""

    raw_response = call_llm(system, user)
    return clean_and_ensure_verdict(raw_response)
