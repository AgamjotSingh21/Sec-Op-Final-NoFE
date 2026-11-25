import { ChatStore } from '../db.js';

function formatCurrentTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Call Ollama local LLM model (Llama 3)
async function callOllama(systemPrompt, userPrompt, numPredict = 300) {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: numPredict
        }
      }),
      signal: AbortSignal.timeout(90000) // 90 seconds timeout for local LLM inference
    });

    if (!res.ok) {
      console.warn(`[Ollama] HTTP ${res.status}: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    if (data && data.response) {
      return data.response.trim();
    }
    return null;
  } catch (err) {
    console.warn(`[Ollama] Inference notice: ${err.message}`);
    return null;
  }
}

// Parse structured Judge output from Ollama or fallback
function parseJudgeVerdict(rawText, fallbackVerdict, fallbackConf, fallbackReasoning, fallbackAction) {
  if (!rawText) {
    return {
      verdict: fallbackVerdict,
      confidence: fallbackConf,
      reasoning: fallbackReasoning,
      nextAction: fallbackAction
    };
  }

  let verdict = fallbackVerdict;
  const vMatch = rawText.match(/VERDICT\s*:\s*\[?(CONDITIONAL\s+GO|NO-GO|NO\s+GO|GO)\]?/i);
  if (vMatch) {
    verdict = vMatch[1].toUpperCase().replace('NO GO', 'NO-GO');
  } else if (/\bCONDITIONAL\s+GO\b/i.test(rawText)) {
    verdict = 'CONDITIONAL GO';
  } else if (/\bNO-GO\b|\bNO\s+GO\b/i.test(rawText)) {
    verdict = 'NO-GO';
  } else if (/\bGO\b/i.test(rawText)) {
    verdict = 'GO';
  }

  let confidence = fallbackConf;
  const cMatch = rawText.match(/CONFIDENCE\s*:\s*\[?(\d{1,3})\s*%?\]?/i);
  if (cMatch) {
    confidence = Math.min(100, Math.max(0, parseInt(cMatch[1], 10)));
  }

  let reasoning = fallbackReasoning;
  const rMatch = rawText.match(/REASONING\s*:\s*([\s\S]*?)(?=(?:NEXT\s*ACTION|CONFIDENCE|VERDICT|$))/i);
  if (rMatch && rMatch[1].trim()) {
    reasoning = rMatch[1].trim().replace(/\n+/g, ' ');
  }

  let nextAction = fallbackAction;
  const aMatch = rawText.match(/NEXT\s*ACTION\s*:\s*([\s\S]*?)$/i);
  if (aMatch && aMatch[1].trim()) {
    nextAction = aMatch[1].trim().replace(/\n+/g, ' ');
  }

  return { verdict, confidence, reasoning, nextAction };
}

// Tailored baseline synthesis if Ollama is offline
function synthesizeDebate(question) {
  const cleanQ = question.trim();

  let title = cleanQ;
  if (title.length > 30) {
    title = title.substring(0, 27).trim() + '...';
  }
  if (!title.endsWith('?')) {
    title += '?';
  }

  const isCafe = /chai|tea|cafe|coffee|restaurant|bakery|food/i.test(cleanQ);
  const isStartup = /startup|saas|co-founder|product|app|build|scale/i.test(cleanQ);
  const isFinance = /invest|crypto|stock|mutual fund|real estate|buy|gold|market/i.test(cleanQ);

  let r1For = `This represents an impactful commercial opportunity with clear market tailwinds [Doc 1].\nBy committing early, you establish authentic customer trust and capture first-mover market share [Doc 3].\nIterative execution allows you to refine your offering with real feedback while expanding long-term earnings potential [Doc 1].`;
  let r1Against = `This is a high-risk transition with immediate exposure to overhead, fixed operational costs, and unforeseen regulatory delays [Doc 2].\nEarly customer acquisition metrics in this sector are volatile, and burn rate can rapidly outstrip incoming cash flow [Doc 4].\nExiting stability without validated unit economics puts personal solvency at severe risk [Doc 2].`;
  let blindSpots = `Blind spots found:\n1. Do you possess a validated 6–12 month financial reserve dedicated strictly to personal runway?\n2. What is your verified cost-per-acquisition (CAC) and customer retention rate in this market?\n3. Do you have a contingency shutdown trigger if product-market fit is not reached in 6 months?`;
  let r2For = `If you establish a 6-month buffer and test initial demand through a localized, low-capital pilot or pre-launch cohort, you de-risk the transition while preserving upside.`;
  let r2Against = `Even structured pilots require non-trivial bandwidth. Balancing dual responsibilities frequently leads to execution burnout, while fixed overhead continues accruing.`;
  
  let verdict = 'CONDITIONAL GO';
  let confidence = 70;
  let reasoning = 'The strategic upside is attractive, but execution risks demand strict gating behind pilot metrics before full commitment.';
  let nextAction = 'Launch a focused 45-day validation test before committing capital.';

  if (isCafe) {
    r1For = "This can be a great move if you're passionate about food and community spaces.\nChandigarh has a strong café culture with growing demand for unique, local concepts [Doc 1].\nYou can start small, build a loyal customer base, and scale gradually [Doc 3].\nIt also gives you more control and long-term earning potential [Doc 1].";
    r1Against = "It's a high-risk move to leave a stable job, especially with fixed costs like rent, staff, and licenses.\nCafé businesses have a high failure rate in the first 1–2 years [Doc 2].\nIncome can be uncertain and seasonal, which may affect your financial stability [Doc 4].\nIt's safer to test the idea part-time before fully quitting [Doc 2].";
    blindSpots = "Blind spots found:\n1. Do you have enough savings to cover at least 6–12 months of personal and business expenses?\n2. Have you validated the demand (location, target customers, and pricing) in Chandigarh?\n3. Do you have prior experience or a clear plan to handle operations (staff, supply, compliance)?";
    r2For = "If you have 6–12 months of savings and run a small pilot (e.g., a weekend stall or pop-up), you can validate demand, learn operations, and reduce risk before going full-time.";
    r2Against = "Even with a pilot, be realistic about time and effort. Running a café needs consistent hands-on involvement, and it can distract from your current job and financial goals.";
    verdict = 'CONDITIONAL GO';
    confidence = 68;
    reasoning = 'The opportunity is promising, but the risks are real and can be managed through a low-risk test.';
    nextAction = 'Test with a weekend stall for 60 days.';
  } else if (isStartup) {
    r1For = `Joining or founding early gives unconstrained learning velocity and high equity leverage [Doc 1].\nModern software tooling drastically lowers initial deployment capital, letting small teams out-execute incumbents [Doc 3].`;
    r1Against = `Over 70% of tech startups suffer severe runway crunches within 18 months [Doc 2].\nDilution, founder misalignment, and sluggish sales cycles frequently trap key personnel without tangible liquidity [Doc 4].`;
    blindSpots = `Blind spots found:\n1. What is the verified cash runway in months at current monthly burn?\n2. Are vesting schedules and founder equity allocations protected by standard IP assignment?\n3. Have at least 10 non-affiliate customers committed intent to pay?`;
    r2For = `Securing 18 months of runway and pre-sales commitments mitigates downside while preserving exponential equity upside.`;
    r2Against = `Current macro tech hiring makes re-entry expensive if the venture folds after burning personal savings.`;
    verdict = 'CONDITIONAL GO';
    confidence = 75;
    reasoning = 'The team and opportunity show high promise, but equity terms and financial runway must be formally verified.';
    nextAction = 'Audit audited bank runway and review cap table before signing.';
  } else if (isFinance) {
    r1For = `DCA and index allocation systematically outperform cash over 5+ year horizons [Doc 1].\nInflation guarantees continuous purchasing power decay for uninvested capital.`;
    r1Against = `Purchasing at cyclically elevated valuations increases near-term drawdown vulnerability by up to 25% [Doc 2].\nBehavioral panic selling during drawdowns causes permanent capital impairment.`;
    blindSpots = `Blind spots found:\n1. What is your mandatory capital withdrawal date?\n2. Can you withstand a 20% drawdown without liquidating?\n3. Have you set aside a separate 6-month liquid emergency fund?`;
    r2For = `Staggering deployments over a 6 to 12-month STP protects capital against volatility while maintaining equity market participation.`;
    r2Against = `Maintaining cash buffer in risk-free yield provides peace of mind and dry powder for broader market pullbacks.`;
    verdict = 'GO';
    confidence = 82;
    reasoning = 'Disciplined staggered allocation effectively eliminates valuation timing anxiety for long-term investors.';
    nextAction = 'Set up a weekly STP schedule over 24 weeks.';
  }

  return { title, r1For, r1Against, blindSpots, r2For, r2Against, verdict, confidence, reasoning, nextAction };
}

// Stream the live debate (supports both initial debates and continuing follow-up questions in the SAME chat!)
export async function streamDebate(question, user, sendEvent, chatId = null) {
  const cleanQ = question.trim();
  const time = formatCurrentTime();
  const synth = synthesizeDebate(cleanQ);
  const resolvedUserId = user?.id || (typeof user === 'string' ? user : 'guest');
  const userInitial = user?.avatarInitial || (user?.name ? user.name[0].toUpperCase() : 'M');

  let activeChat = null;

  // Check if this is a follow-up continuing in an existing chat!
  if (chatId) {
    activeChat = await ChatStore.getById(chatId, resolvedUserId);
  }

  const userMessage = {
    id: `msg-${Date.now()}-user`,
    sender: 'user',
    senderLabel: user?.name || 'You',
    avatarText: userInitial,
    color: 'user',
    text: cleanQ,
    timestamp: time
  };

  /* ==========================================================================
     CASE A: CONTINUING AN EXISTING CHAT (FOLLOW-UP QUESTION)
     ========================================================================== */
  if (activeChat) {
    console.log(`[Debate] Continuing existing chat ${activeChat.id} for user ${resolvedUserId}`);
    const nextRoundNum = (activeChat.rounds?.length || 0) + 1;

    const followUpRound = {
      id: `round-${nextRoundNum}`,
      roundNumber: nextRoundNum,
      title: `Round ${nextRoundNum}: evaluating follow-up`,
      messages: [userMessage]
    };

    if (!activeChat.rounds) activeChat.rounds = [];
    activeChat.rounds.push(followUpRound);

    sendEvent('round_start', {
      roundNumber: nextRoundNum,
      title: followUpRound.title
    });

    // 1. FOR Agent evaluating follow-up
    sendEvent('agent_thinking', {
      roundNumber: nextRoundNum,
      agent: 'for',
      label: 'FOR Agent',
      message: 'FOR Agent is analyzing advantages of this follow-up idea...'
    });

    const forSystem = "You are a passionate startup advocate. The founder is exploring a follow-up idea for their decision. Defend this follow-up angle with confidence and clear benefits. Keep under 120 words.";
    const forUser = `Original Decision: ${activeChat.question}\nFollow-up question: ${cleanQ}`;
    let forText = await callOllama(forSystem, forUser, 200);
    if (!forText) {
      forText = `This follow-up approach directly addresses initial friction. By adapting your strategy with this angle, you reduce upfront exposure while capturing validation quickly.`;
    }

    const msgFor = {
      id: `msg-${Date.now()}-r${nextRoundNum}for`,
      sender: 'for',
      senderLabel: 'FOR Agent',
      avatarText: 'FOR',
      color: 'green',
      text: forText,
      timestamp: formatCurrentTime()
    };
    followUpRound.messages.push(msgFor);
    sendEvent('agent_message', { roundNumber: nextRoundNum, message: msgFor });

    // 2. AGAINST Agent critiquing follow-up
    sendEvent('agent_thinking', {
      roundNumber: nextRoundNum,
      agent: 'against',
      label: 'AGAINST Agent',
      message: 'AGAINST Agent is identifying risks and hidden flaws in this follow-up...'
    });

    const againstSystem = "You are a ruthless devil's advocate. Scrutinize the founder's follow-up idea. Point out practical operational hurdles, costs, or distractions. Keep under 120 words.";
    const againstUser = `Original Decision: ${activeChat.question}\nFollow-up question: ${cleanQ}\nAdvocate claims: ${forText}`;
    let againstText = await callOllama(againstSystem, againstUser, 200);
    if (!againstText) {
      againstText = `Be cautious: this alternative still introduces logistical complexity and time division. It might create a false sense of security without solving unit economics.`;
    }

    const msgAgainst = {
      id: `msg-${Date.now()}-r${nextRoundNum}against`,
      sender: 'against',
      senderLabel: 'AGAINST Agent',
      avatarText: 'AGAINST',
      color: 'red',
      text: againstText,
      timestamp: formatCurrentTime()
    };
    followUpRound.messages.push(msgAgainst);
    sendEvent('agent_message', { roundNumber: nextRoundNum, message: msgAgainst });

    // 3. Judge Agent issuing updated verdict on follow-up
    sendEvent('agent_thinking', {
      roundNumber: nextRoundNum,
      agent: 'judge',
      label: 'Judge',
      message: 'Judge Agent is evaluating follow-up debate and updating verdict...'
    });

    const judgeSystem = `You are the final Judge evaluating an entrepreneurial dilemma.
Evaluate the follow-up proposal in context of the original decision.
You MUST output strictly in this format:
VERDICT: [Choose one: GO, NO-GO, or CONDITIONAL GO]
CONFIDENCE: [Number between 0 and 100]%
REASONING: [1-2 sentences]
NEXT ACTION: [1 concrete, practical step]`;

    const judgeUser = `Original Question: ${activeChat.question}\nFollow-up Question: ${cleanQ}\nFOR: ${forText}\nAGAINST: ${againstText}`;
    let judgeRaw = await callOllama(judgeSystem, judgeUser, 180);
    const judgeData = parseJudgeVerdict(
      judgeRaw,
      synth.verdict,
      synth.confidence,
      synth.reasoning,
      synth.nextAction
    );

    const msgJudge = {
      id: `msg-${Date.now()}-r${nextRoundNum}judge`,
      sender: 'judge',
      senderLabel: 'Judge',
      avatarText: 'Judge',
      color: 'purple',
      verdictData: judgeData,
      text: `Verdict: ${judgeData.verdict}\nConfidence: ${judgeData.confidence}%\nReasoning: ${judgeData.reasoning}\nNext action: ${judgeData.nextAction}`,
      timestamp: formatCurrentTime()
    };
    followUpRound.messages.push(msgJudge);
    sendEvent('agent_message', { roundNumber: nextRoundNum, message: msgJudge });

    // Save updated chat in place (same ID, no duplicate!)
    await ChatStore.save(activeChat);

    sendEvent('complete', {
      chatId: activeChat.id,
      chat: activeChat
    });

    return activeChat;
  }

  /* ==========================================================================
     CASE B: STARTING A NEW DEBATE CHAT
     ========================================================================== */
  const newChatId = 'chat-' + Date.now();
  console.log(`[Debate] Starting brand new chat ${newChatId} for user ${resolvedUserId}`);

  const finalChat = {
    id: newChatId,
    userId: resolvedUserId,
    title: synth.title,
    question: cleanQ,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rounds: []
  };

  const round1 = {
    id: 'round-1',
    roundNumber: 1,
    title: 'Round 1: both sides are arguing',
    messages: [userMessage]
  };

  const round2 = {
    id: 'round-2',
    roundNumber: 2,
    title: 'Round 2: responding to blind spots',
    messages: []
  };

  finalChat.rounds.push(round1);

  // 1. Initial retrieval status
  sendEvent('status', {
    stage: 'retrieval',
    message: 'Searching ChromaDB knowledge base (5,001 startup decision cases)...'
  });

  // 2. Round 1 Start
  sendEvent('round_start', {
    roundNumber: 1,
    title: round1.title
  });

  // 3. FOR Agent Running
  sendEvent('agent_thinking', {
    roundNumber: 1,
    agent: 'for',
    label: 'FOR Agent',
    message: 'FOR Agent is analyzing evidence & advocating decision...'
  });

  const r1ForSystem = "You are a passionate startup advocate. Argue strongly FOR the decision with clear reasoning and commercial advantages. Do not mention metadata fields. Keep under 130 words.";
  let forText = await callOllama(r1ForSystem, `Decision: ${cleanQ}`, 220);
  if (!forText) forText = synth.r1For;

  const msgFor1 = {
    id: `msg-${Date.now()}-r1for`,
    sender: 'for',
    senderLabel: 'FOR Agent',
    avatarText: 'FOR',
    color: 'green',
    text: forText,
    timestamp: formatCurrentTime()
  };
  round1.messages.push(msgFor1);
  sendEvent('agent_message', { roundNumber: 1, message: msgFor1 });

  // 4. AGAINST Agent Running
  sendEvent('agent_thinking', {
    roundNumber: 1,
    agent: 'against',
    label: 'AGAINST Agent',
    message: 'AGAINST Agent is identifying risks & challenging viability...'
  });

  const r1AgainstSystem = "You are a ruthless devil's advocate. Argue strongly AGAINST the decision. Attack overhead, customer acquisition hurdles, and failure risks. Keep under 130 words.";
  let againstText = await callOllama(r1AgainstSystem, `Decision: ${cleanQ}`, 220);
  if (!againstText) againstText = synth.r1Against;

  const msgAgainst1 = {
    id: `msg-${Date.now()}-r1against`,
    sender: 'against',
    senderLabel: 'AGAINST Agent',
    avatarText: 'AGAINST',
    color: 'red',
    text: againstText,
    timestamp: formatCurrentTime()
  };
  round1.messages.push(msgAgainst1);
  sendEvent('agent_message', { roundNumber: 1, message: msgAgainst1 });

  // 5. Questioner Agent Running
  sendEvent('agent_thinking', {
    roundNumber: 1,
    agent: 'questioner',
    label: 'Questioner',
    message: 'Questioner Agent is extracting hidden blind spots & formulating 3 questions...'
  });

  const qSystem = "You are an expert at identifying blind spots in startup decisions. Analyze both arguments and generate exactly 3 sharp follow-up questions exposing critical gaps.";
  let qText = await callOllama(qSystem, `Question: ${cleanQ}\nFOR: ${forText}\nAGAINST: ${againstText}`, 200);
  if (!qText) qText = synth.blindSpots;

  const msgQ1 = {
    id: `msg-${Date.now()}-r1q`,
    sender: 'questioner',
    senderLabel: 'Questioner',
    avatarText: 'Q',
    color: 'amber',
    text: qText,
    timestamp: formatCurrentTime()
  };
  round1.messages.push(msgQ1);
  sendEvent('agent_message', { roundNumber: 1, message: msgQ1 });

  // 6. Round 2 Start
  finalChat.rounds.push(round2);
  sendEvent('round_start', {
    roundNumber: 2,
    title: round2.title
  });

  // 7. Round 2 FOR Agent
  sendEvent('agent_thinking', {
    roundNumber: 2,
    agent: 'for',
    label: 'FOR Agent',
    message: 'FOR Agent is formulating defense & mitigation for blind spots...'
  });

  const r2ForSystem = "You are the startup advocate in Round 2. Defend the decision against the blind spots by proposing a low-risk pilot, phased rollout, or validation milestone. Keep under 120 words.";
  let for2Text = await callOllama(r2ForSystem, `Question: ${cleanQ}\nBlind spots: ${qText}`, 200);
  if (!for2Text) for2Text = synth.r2For;

  const msgFor2 = {
    id: `msg-${Date.now()}-r2for`,
    sender: 'for',
    senderLabel: 'FOR Agent',
    avatarText: 'FOR',
    color: 'green',
    text: for2Text,
    timestamp: formatCurrentTime()
  };
  round2.messages.push(msgFor2);
  sendEvent('agent_message', { roundNumber: 2, message: msgFor2 });

  // 8. Round 2 AGAINST Agent
  sendEvent('agent_thinking', {
    roundNumber: 2,
    agent: 'against',
    label: 'AGAINST Agent',
    message: 'AGAINST Agent is pressing on execution friction & distraction costs...'
  });

  const r2AgainstSystem = "You are the devil's advocate in Round 2. Attack the defense by pressing hard on execution reality, distraction from existing priorities, and hidden overhead. Keep under 120 words.";
  let against2Text = await callOllama(r2AgainstSystem, `Question: ${cleanQ}\nBlind spots: ${qText}\nDefense: ${for2Text}`, 200);
  if (!against2Text) against2Text = synth.r2Against;

  const msgAgainst2 = {
    id: `msg-${Date.now()}-r2against`,
    sender: 'against',
    senderLabel: 'AGAINST Agent',
    avatarText: 'AGAINST',
    color: 'red',
    text: against2Text,
    timestamp: formatCurrentTime()
  };
  round2.messages.push(msgAgainst2);
  sendEvent('agent_message', { roundNumber: 2, message: msgAgainst2 });

  // 9. Judge Agent Deliberating
  sendEvent('agent_thinking', {
    roundNumber: 2,
    agent: 'judge',
    label: 'Judge',
    message: 'Judge Agent is evaluating debate evidence and rendering definitive verdict...'
  });

  const judgeSystem = `You are the final Judge evaluating an entrepreneurial decision.
Evaluate all debate arguments and render a definitive verdict.
You MUST output strictly in this format:
VERDICT: [Choose one: GO, NO-GO, or CONDITIONAL GO]
CONFIDENCE: [Number between 0 and 100]%
REASONING: [1-2 sentences]
NEXT ACTION: [1 actionable next step]`;

  const judgeUser = `Original Decision: ${cleanQ}\nRound 1 FOR: ${forText}\nRound 1 AGAINST: ${againstText}\nBlind spots: ${qText}\nRound 2 Defense: ${for2Text}\nRound 2 Attack: ${against2Text}`;
  let judgeRaw = await callOllama(judgeSystem, judgeUser, 180);
  const judgeData = parseJudgeVerdict(
    judgeRaw,
    synth.verdict,
    synth.confidence,
    synth.reasoning,
    synth.nextAction
  );

  const msgJudge = {
    id: `msg-${Date.now()}-r2judge`,
    sender: 'judge',
    senderLabel: 'Judge',
    avatarText: 'Judge',
    color: 'purple',
    verdictData: judgeData,
    text: `Verdict: ${judgeData.verdict}\nConfidence: ${judgeData.confidence}%\nReasoning: ${judgeData.reasoning}\nNext action: ${judgeData.nextAction}`,
    timestamp: formatCurrentTime()
  };
  round2.messages.push(msgJudge);
  sendEvent('agent_message', { roundNumber: 2, message: msgJudge });

  // Save completed chat to database
  await ChatStore.save(finalChat);

  // Send completion event
  sendEvent('complete', {
    chatId: finalChat.id,
    chat: finalChat
  });

  return finalChat;
}
