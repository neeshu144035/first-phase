import os
from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.agent import get_lesson_prompt, rag_retriever
from backend.tools.llm_tools import stream_grok, summarize_text,stream_chat

app = FastAPI()

# Path to the image directory
image_dir = os.path.join(os.path.dirname(__file__), "tools", "images")

# Mount static files
app.mount("/images", StaticFiles(directory=image_dir), name="images")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper: use LLM to classify confirmation
async def classify_confirmation(reply: str) -> bool:
    """
    Returns True if the LLM classifies the reply as indicating understanding.
    """
    classifier_prompt = (
        f"You are a helpful assistant. The student just replied:\n\n"
        f"\"{reply}\"\n\n"
        "Does this message indicate that the student understood the previous explanation?"
        " Answer with just 'Yes' or 'No'."
    )
    response = ""
    async for chunk in stream_grok(classifier_prompt):
        response += chunk
    first = response.strip().split()[0].lower()
    return first.startswith("y")

# --------- Confirmation Endpoint ---------
class ConfirmRequest(BaseModel):
    message: str

@app.post("/confirm")
async def confirm_understanding(req: ConfirmRequest):
    is_confirm = await classify_confirmation(req.message)
    return {"confirm": is_confirm}

# --------- Chat Endpoint ---------
class ChatRequest(BaseModel):
    subtopic: str
    history: list[dict]
    question: str

@app.post("/chat")
async def chat(req: ChatRequest):
    # 1. Retrieve lesson context
    context = "\n".join(rag_retriever.retrieve(req.subtopic, k=5))
    out_of_syllabus = not context.strip()

    # 2. Build system prompt
    if out_of_syllabus:
        system_prompt = (
            "⚠️ This question is outside the syllabus. Provide a general answer and warn the student: 'This is outside the syllabus.'\n\n"
        )
    else:
        system_prompt = "You are an 8th-grade science teacher. Answer student questions using the lesson content. "
    system_prompt += (
        "By default, give short, doubt-clearing answers. "
        "If the student requests a specific length (e.g., '10 marks', '200 words'), provide a detailed response. "
        "Always end with a follow-up: 'Did that help?', or 'Which part needs more detail?'."
    )

    # 3. Assemble message sequence
    messages = [{"role": "system", "content": system_prompt}]
    if not out_of_syllabus:
        messages.append({"role": "system", "content": f"Lesson content:\n{context}"})

    # Inject previous chat history
    for turn in req.history:
        role = "user" if turn.get("role") == "student" else "assistant"
        messages.append({"role": role, "content": turn.get("text", "")})

    # Add the new student question
    messages.append({"role": "user", "content": req.question})

    # 4. Stream the model's response
        # 4. Flatten messages and stream via generate_content
    async def event_stream():
        # Build one text prompt from your message history
        prompt = "\n".join(
            f"{m['role'].upper()}: {m['content']}"
            for m in messages
        )
        # Stream it through your existing generate_content helper
        async for chunk in stream_grok(prompt):
            yield chunk

    return StreamingResponse(event_stream(), media_type="text/plain")


# --------- WebSocket /ws/lesson ---------
@app.websocket("/ws/lesson")
async def lesson_stream(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_json()
    prompt = get_lesson_prompt(data["subtopic"])
    if "**[OUT_OF_SYLLABUS]**" in prompt:
        await websocket.send_text(
            "\n**This topic seems to be outside the syllabus. Here's a general overview anyway...**\n"
        )
        prompt = (
            f"You are a science teacher. Give a general, engaging explanation of the topic: {data['subtopic']}"
        )
    full_text = ""
    buffer = ""
    async for chunk in stream_grok(prompt):
        buffer += chunk
        has_open = "<<" in buffer
        has_close = ">>" in buffer
        if (len(buffer) > 300 and not (has_open and not has_close)) or buffer.endswith((".", "!", "?")):
            await websocket.send_text(buffer)
            full_text += buffer
            buffer = ""
    if buffer.strip():
        await websocket.send_text(buffer)
        full_text += buffer
    await websocket.send_text("\n\n\n**Lesson Complete! Generating summary...**\n")
    summary = await summarize_text(full_text)
    await websocket.send_text(f"**Summary:** {summary}")
    await websocket.send_text("[[DONE]]")
    await websocket.close()
