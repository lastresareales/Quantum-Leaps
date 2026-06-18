import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = "gemini-3.1-pro-preview";

const SYSTEM_INSTRUCTION = `You are "Quantum Coach", the AI engine behind Quantum Leaps. 
Your purpose is to break down ambitious goals into "microscopic steps" that fit into a user's real-world schedule.

When a user provides a goal:
1.  **Interrogate**: Do not immediately give steps. Ask 3-5 sharp, probing questions to understand:
    -   Specific constraints (financial, tools, physical space).
    -   Current habits/schedule (Even if they only have 15 mins).
    -   Expertise level.
    -   True motivation (the "Why").
2.  **Analyze**: Once you have enough info, generate microscopic steps. 
    -   Steps should be as small as 15 minutes.
    -   Include difficulty (1-5) and estimated duration.
3.  **Tonality**: Sophisticated, professional, encouraging but clinical in precision.

Format your "interrogation" responses clearly.
Format your "breakdown" responses as a list of steps with duration and difficulty.`;

export async function interrogateGoal(goalTitle: string, history: { role: string; content: string }[]) {
  const contents = [
    { role: 'user', parts: [{ text: `I want to achieve this goal: "${goalTitle}"` }] },
    ...history.map(h => ({ role: h.role === 'assistant' ? 'model' : h.role, parts: [{ text: h.content }] }))
  ];

  const response = await ai.models.generateContent({
    model,
    contents: contents as any,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7,
    },
  });

  return response.text;
}

export async function generateNextPhaseSteps(
  goalTitle: string, 
  context: string, 
  existingStepsCount: number, 
  nextPhaseIndex: number
) {
  const response = await ai.models.generateContent({
    model,
    contents: `Based on this goal: "${goalTitle}" and the context of previous coaching communication: "${context}", generate Phase ${nextPhaseIndex} of 20 of this long-term journey (where each phase represents 5% progress).
    
    Generate EXACTLY 10 detailed, microscopic, sequential steps for Phase ${nextPhaseIndex}.
    
    CRITICAL: The user has already completed Phase ${nextPhaseIndex - 1} (comprising the first ${existingStepsCount} steps). 
    This phase must logically transition and build directly upon the previous execution to advance the user's progress. Do NOT repeat or duplicate previous steps. The steps must be sequentially aligned and orderly.
    
    Each step must be actionable in 15-30 minutes.
    Ensure "description" contains specific, detailed instructions or exercises to perform.
    Return the response in JSON format containing EXACTLY 10 steps.`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                durationMinutes: { type: Type.NUMBER },
                difficulty: { type: Type.NUMBER }
              },
              required: ["title", "description", "durationMinutes", "difficulty"]
            }
          }
        },
        required: ["steps"]
      }
    }
  });

  return JSON.parse(response.text || '{"steps": []}');
}


export async function generateMicroSteps(goalTitle: string, context: string) {
  const response = await ai.models.generateContent({
    model,
    contents: `Based on this goal: "${goalTitle}" and this context: "${context}", generate a series of EXACTLY 10 detailed, microscopic, sequential steps representing Phase 1 of 20 (the first 5% of the total journey).
    
    CRITICAL: This is an ambitious goal that will take months or years (comprising 20 phases of 10 steps each, each phase representing 5% progress). This Phase 1 must represent the absolute foundational onboarding of Phase 1 of 20, keeping steps extremely micro (15-30 mins). Do not skip or rush ahead.
    
    Each step must be actionable in 15-30 minutes.
    Ensure "description" contains specific instructions or exercises to perform.
    Return the response in JSON format containing EXACTLY 10 steps.`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                durationMinutes: { type: Type.NUMBER },
                difficulty: { type: Type.NUMBER }
              },
              required: ["title", "description", "durationMinutes", "difficulty"]
            }
          }
        },
        required: ["steps"]
      }
    }
  });

  return JSON.parse(response.text || '{"steps": []}');
}

export async function generatePhaseQuiz(goalTitle: string, phaseIndex: number, stepsText: string) {
  const response = await ai.models.generateContent({
    model,
    contents: `You are the Quantum Coach Exam Generator. Based on the master goal: "${goalTitle}", and the following 10 steps recently completed by the user in Phase ${phaseIndex} of 20:
    
    ${stepsText}
    
    Generate the "Phase ${phaseIndex} Competency Exam". 
    You MUST generate EXACTLY 25 multiple choice questions.
    
    Rules for the questions:
    1. Every question must directly pertain to the knowledge, concepts, practical tasks, or specific exercises covered in these 10 phase steps.
    2. Each question must have EXACTLY 4 options (A, B, C, and D).
    3. Option labels must be informative (do not use low-value options like "All of the above" or "None of the above").
    4. Provide a clear, detailed, and educational explanation of why the correct option is indeed correct.
    5. The difficulty of the questions should range from basic review to advanced applications of the phase concepts.
    
    Return the output in clean JSON format following the schema. Ensure there are exactly 25 questions.`,
    config: {
      systemInstruction: "You are the Quantum Coach Exam Generator. Provide highly professional, rigorous, and relevant academic multiple-choice quizzes in proper JSON format.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING } 
                },
                correctIndex: { type: Type.NUMBER },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "correctIndex", "explanation"]
            }
          }
        },
        required: ["questions"]
      }
    }
  });

  return JSON.parse(response.text || '{"questions": []}');
}

export async function generateTerminalChallenge(goalTitle: string, stepTitle: string, stepDescription: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: `Analyze this master goal: "${goalTitle}", step title: "${stepTitle}", and step instructions: "${stepDescription}".
    
    Determine if this step can be practiced in a command-line interface, terminal, or programming sandbox (e.g., Python, SQL, Bash, Git, HTML/JS, or programming/system administration in general).
    
    If yes:
    - Set isTerminalPractice = true.
    - Provide a specific interactive code challenge that the user can run in a playground terminal.
    - Select a practiceType: "python", "javascript", "bash", "sql", or "generic".
    - Provide a premium externalPracticeLink to a real VM, playground, or scratchpad where they can do this (e.g., for Python: 'https://colab.research.google.com/', for general code: 'https://replit.com/languages/python3', for SQL: 'https://sqliteonline.com/', for Docker/Bash: 'https://labs.play-with-docker.com/' or 'https://bellard.org/jslinux/').
    
    If no:
    - Set isTerminalPractice = false.
    - Provide a general high-fidelity reflective practice or terminal-simulation exercise so they can still interact with an simulated command suite.
    - Select practiceType: "generic".
    - Provide a general external link (e.g. 'https://github.com/').
    
    Return the response as JSON.`,
    config: {
      systemInstruction: "You are the Quantum Terminal Challenge Generator. You output highly relevant hands-on terminal lessons and verification rules in valid JSON format.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isTerminalPractice: { type: Type.BOOLEAN },
          practiceType: { type: Type.STRING },
          tutorialMarkdown: { type: Type.STRING },
          challengeInstructions: { type: Type.STRING },
          startingCode: { type: Type.STRING },
          hint: { type: Type.STRING },
          externalPracticeLink: { type: Type.STRING }
        },
        required: ["isTerminalPractice", "practiceType", "tutorialMarkdown", "challengeInstructions", "startingCode", "hint", "externalPracticeLink"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
}

export async function verifyCodeSolution(
  goalTitle: string, 
  stepTitle: string, 
  stepInstructions: string, 
  code: string, 
  stdout: string
) {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: `Verify if the user's coded solution or input satisfies the objective.
    Master Goal: "${goalTitle}"
    Step: "${stepTitle}"
    Instructions: "${stepInstructions}"
    
    User's Code/Solution:
    \`\`\`
    ${code}
    \`\`\`
    
    Execution Output (stdout/stderr):
    \`\`\`
    ${stdout}
    \`\`\`
    
    Examine the code and output critically. If the user either compiled working code solving the prompt, or executed a simulated command sequence successfully completing the step objectives, set passed = true. Write a short clinical encouraging review in "feedback".`,
    config: {
      systemInstruction: "You are the Quantum Terminal Solution Grader. You critically evaluate code submissions and response logs, returning a validated JSON payload.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          passed: { type: Type.BOOLEAN },
          feedback: { type: Type.STRING }
        },
        required: ["passed", "feedback"]
      }
    }
  });

  return JSON.parse(response.text || '{"passed": false, "feedback": "Evaluation failed. Please try again."}');
}
