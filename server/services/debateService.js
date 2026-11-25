import { ChatStore } from '../db.js';

function formatCurrentTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
let resolvedModel = process.env.OLLAMA_MODEL || null;

async function resolveModel() {
  if (resolvedModel) return resolvedModel;

  const res = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) {
    throw new Error(`Ollama is not reachable at ${OLLAMA_URL} (HTTP ${res.status}). Start it with: ollama serve`);
  }

  const data = await res.json();
  const names = (data.models || []).map(model => model.name).filter(Boolean);
  const preferred = names.find(name => name.startsWith('llama3'))
    || names.find(name => name.startsWith('llama'))
    || names[0];

  if (!preferred) {
    throw new Error('Ollama is running, but no model is installed. Pull one with: ollama pull llama3');
  }

  resolvedModel = preferred;
  console.log(`[Ollama] Using model ${resolvedModel}`);
  return resolvedModel;
}

// Call the local Ollama model. Throws if the model cannot answer — never substitutes canned text.
async function callOllama(systemPrompt, userPrompt, numPredict = 300) {
  const model = await resolveModel();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      options: {
        temperature: 0.7,
        num_predict: numPredict
      }
    }),
    signal: AbortSignal.timeout(180000)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${model} failed (HTTP ${res.status}): ${body.slice(0, 240)}`);
  }

  const data = await res.json();
  const text = data?.message?.content || data?.response || '';
  if (!text.trim()) {
    throw new Error(`Ollama ${model} returned an empty response`);
  }
  return text.trim();
}

function makeTitle(question) {
  let title = question.trim();
  if (title.length > 48) {
    title = title.substring(0, 45).trim() + '...';
  }
  if (!title.endsWith('?')) {
    title += '?';
  }
  return title;
}

function recentDebateContext(chat) {
  const messages = (chat?.rounds || [])
    .flatMap(round => round.messages || [])
    .filter(message => message.sender !== 'user')
    .slice(-6);
  if (messages.length === 0) return '';
  return messages
    .map(message => `${message.senderLabel}: ${(message.text || '').slice(0, 500)}`)
    .join('\n\n');
}

function enforceNoGoForIllegalActivity(verdict, question, agentResponses = []) {
  const questionText = question;
  const responseText = agentResponses.join('\n');
  const explicitlyIllegal = /\b(illegal|unlawful|against the law|criminal activity|illegal activity|illegal business)\b/i.test(questionText);
  const illicitConduct = /\b(smuggl(?:e|ing)|counterfeit(?:ing)?|money laundering|tax evasion|evade taxes|brib(?:e|ery)|fraud(?:ulent)?|scam(?:ming)?|traffick(?:ing)?|sell stolen goods|trade stolen goods|drug trafficking)\b/i.test(questionText);
  const modelRefusal = /\b(?:cannot|can't|unable to|won't)\s+(?:provide|give|assist with|help with)[^.!?]{0,100}\b(?:illegal|illicit|criminal|unlawful)\b/i.test(responseText);

  if (!explicitlyIllegal && !illicitConduct && !modelRefusal) return verdict;

  return {
    verdict: 'NO-GO',
    confidence: 95,
    reasoning: 'The proposal involves illegal activity. The recommendation is NO-GO because proceeding could expose people to serious legal and financial consequences.',
    nextAction: 'Do not proceed with the illegal activity; seek qualified legal advice about lawful alternatives.'
  };
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

// Stream the live debate (supports both initial debates and continuing follow-up questions in the SAME chat!)
export async function streamDebate(question, user, sendEvent, chatId = null) {
  const cleanQ = question.trim();
  const time = formatCurrentTime();
  const resolvedUserId = user?.id || (typeof user === 'string' ? user : 'guest');
  const userInitial = user?.avatarInitial || (user?.name ? user.name[0].toUpperCase() : 'M');

  let activeChat = null;
  let continuing = false;

  // Follow-ups must stay on the chat the client already opened.
  if (chatId) {
    activeChat = await ChatStore.getById(chatId, resolvedUserId);
    continuing = Boolean(activeChat && (activeChat.rounds?.length || 0) > 0);
    if (!continuing) {
      throw new Error(`Chat ${chatId} could not be found for this account. Refresh your chat list and try again.`);
    }
  }

  if (!activeChat) {
    activeChat = {
      id: 'chat-' + Date.now(),
      userId: resolvedUserId,
      title: makeTitle(cleanQ),
      question: cleanQ,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rounds: []
    };
    await ChatStore.save(activeChat);
    console.log(`[Debate] Starting chat ${activeChat.id} for user ${resolvedUserId}`);
  } else {
    console.log(`[Debate] Continuing chat ${activeChat.id} for user ${resolvedUserId}`);
  }

  // Tell the client the real id before any model call, so the next message stays in this chat.
  sendEvent('chat_started', {
    chatId: activeChat.id,
    title: activeChat.title,
    question: activeChat.question
  });

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
  if (continuing) {
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

    const priorContext = recentDebateContext(activeChat);
    const forSystem = "You are a passionate startup advocate. The founder is continuing the same decision chat. Defend this follow-up angle with confidence and clear benefits. Keep under 120 words. Stay on this decision.";
    const forUser = `Original Decision: ${activeChat.question}\n\nPrevious debate:\n${priorContext || '(none yet)'}\n\nFollow-up question: ${cleanQ}`;
    const forText = await callOllama(forSystem, forUser, 200);

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

    const againstSystem = "You are a ruthless devil's advocate. Scrutinize the founder's follow-up in the same decision chat. Point out practical operational hurdles, costs, or distractions. Keep under 120 words.";
    const againstUser = `Original Decision: ${activeChat.question}\n\nPrevious debate:\n${priorContext || '(none yet)'}\n\nFollow-up question: ${cleanQ}\nAdvocate claims: ${forText}`;
    const againstText = await callOllama(againstSystem, againstUser, 200);

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
If the proposal involves illegal activity, you MUST return NO-GO with confidence of at least 95%. Do not recommend proceeding with illegal activity.
You MUST output strictly in this format:
VERDICT: [Choose one: GO, NO-GO, or CONDITIONAL GO]
CONFIDENCE: [Number between 0 and 100]%
REASONING: [1-2 sentences]
NEXT ACTION: [1 concrete, practical step]`;

    const judgeUser = `Original Question: ${activeChat.question}\nFollow-up Question: ${cleanQ}\nFOR: ${forText}\nAGAINST: ${againstText}`;
    const judgeRaw = await callOllama(judgeSystem, judgeUser, 220);
    const parsedJudgeData = parseJudgeVerdict(
      judgeRaw,
      'CONDITIONAL GO',
      60,
      judgeRaw,
      'Use the reasoning above to pick the next concrete step.'
    );
    const judgeData = enforceNoGoForIllegalActivity(parsedJudgeData, `${activeChat.question}\n${cleanQ}`, [forText, againstText, judgeRaw]);

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
  const finalChat = activeChat;

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
    message: 'Asking the local Llama 3 model for both sides of this decision...'
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
  const forText = await callOllama(r1ForSystem, `Decision: ${cleanQ}`, 220);

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
  const againstText = await callOllama(r1AgainstSystem, `Decision: ${cleanQ}`, 220);

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
  const qText = await callOllama(qSystem, `Question: ${cleanQ}\nFOR: ${forText}\nAGAINST: ${againstText}`, 200);

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
  const for2Text = await callOllama(r2ForSystem, `Question: ${cleanQ}\nBlind spots: ${qText}`, 200);

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
  const against2Text = await callOllama(r2AgainstSystem, `Question: ${cleanQ}\nBlind spots: ${qText}\nDefense: ${for2Text}`, 200);

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
If the proposal involves illegal activity, you MUST return NO-GO with confidence of at least 95%. Do not recommend proceeding with illegal activity.
You MUST output strictly in this format:
VERDICT: [Choose one: GO, NO-GO, or CONDITIONAL GO]
CONFIDENCE: [Number between 0 and 100]%
REASONING: [1-2 sentences]
NEXT ACTION: [1 actionable next step]`;

  const judgeUser = `Original Decision: ${cleanQ}\nRound 1 FOR: ${forText}\nRound 1 AGAINST: ${againstText}\nBlind spots: ${qText}\nRound 2 Defense: ${for2Text}\nRound 2 Attack: ${against2Text}`;
  const judgeRaw = await callOllama(judgeSystem, judgeUser, 280);
  const parsedJudgeData = parseJudgeVerdict(
    judgeRaw,
    'CONDITIONAL GO',
    60,
    judgeRaw,
    'Use the reasoning above to pick the next concrete step.'
  );
  const judgeData = enforceNoGoForIllegalActivity(parsedJudgeData, cleanQ, [forText, againstText, qText, for2Text, against2Text, judgeRaw]);

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

export async function seedInitialDataIfNeeded() {
  return;
}
