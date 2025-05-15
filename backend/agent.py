import os 
import re
from langchain.agents import initialize_agent, Tool
from langchain_community.chat_models import ChatOpenAI
from backend.tools.llm_tools import stream_grok
from backend.tools.refactored_retriever import RAGRetriever
from backend.tools.image_fetcher import fetch_figures_only, search_subchapter_by_query
from backend.tools.video_fetcher import fetch_animated_videos

rag_retriever = RAGRetriever(
    knowledge_path="backend/knowledgebase.json",
    metadata_path="backend/metadata.json",
    embed_path="backend/title_embeddings.npy",
    index_path="backend/faiss_index_ms_marco.index"
)

def custom_retrieve_tool(input_text):
    results = rag_retriever.retrieve(input_text, k=5)
    return "\n".join(results)

def strip_figure_mentions(text):
    return re.sub(r"Figure[\s_]*\d+(\.\d+)?", "", text, flags=re.IGNORECASE)

tools = [
    Tool(name="RetrieveTextbook", func=custom_retrieve_tool, description="Retrieve textbook explanation"),
]

def get_lesson_prompt(subtopic):
    retrieved = custom_retrieve_tool(subtopic)
    if not retrieved.strip() or "[Warning]" in retrieved:
        return "**[OUT_OF_SYLLABUS]**"

    retrieved_cleaned = strip_figure_mentions(retrieved)

    exact_subchapter_name = search_subchapter_by_query(subtopic)
    figures = []
    if exact_subchapter_name:
        figures = fetch_figures_only(exact_subchapter_name) 

    if figures:
        
        
        
        ("Retrieved figures for the lesson:")
        for fig_info in figures:
            print(f"   - Reference Name: {fig_info['name']}, Path: {fig_info['path']}, Filename for marker: {os.path.basename(fig_info['path'])}")
    else:
        print(f"No figures retrieved for subtopic: {subtopic}")
    
    video = fetch_animated_videos(subtopic)

    image_list = "\n".join(f"<<image:{os.path.basename(fig['path'])}>>" for fig in figures) if figures else "- None found"

    video_list = f"<<video:{video['id']}>>" if video else "None"

    return (
        f"You are a fun and interactive 8th grade science teacher. Your job is to teach the topic "
        f"You must use the EXACT tags <<image:filename>> and <<video:id>> at the right places in your explanation. Do not forget or skip this."
        f"'{subtopic}' using the content below.\n\n"
        f"{retrieved}\n\n"
        f"# Available images (use <<image:NAME>> to embed):\n"
        f"{image_list}\n\n"
        f"# Available video (use <<video:ID>> to embed):\n"
        f"{video_list}\n\n"
        "Now, generate a flowing lesson that:\n"
        "1. Explains each 2–3 related textbook points with analogies or fun facts.\n"
        "2. **Introduces the image** at the right moment, e.g. <<image:Figure_1.3>> to display the image."
        "Avoid repeating the same image more than once in the explanation."
        "3. **Introduces the YouTube video** at the right moment, e.g. <<video:abcd1234>> to show the clip.\n"
        "4. Poses natural follow-up checks like 'Still with me?' or 'Want me to explain that part again?'\n"
        "5. Concludes with a friendly summary and says: 'That’s the wrap!'\n"
    )