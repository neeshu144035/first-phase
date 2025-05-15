import React, { useState } from 'react';
import LessonStream from './LessonStream';
import ChatWindow from './ChatWindow';

function App() {
  // Controlled input for typing the topic
  const [topicInput, setTopicInput] = useState("");
  // Active lesson subtopic
  const [subtopic, setSubtopic] = useState("");
  const [lessonStarted, setLessonStarted] = useState(false);

  // Tracks if user is in question (doubt) mode
  const [questionMode, setQuestionMode] = useState(false);
  // Used to reset LessonStream when restarting
  const [streamKey, setStreamKey] = useState(0);
  const [chatHistory, setChatHistory] = useState([]);

  const handleStartLesson = () => {
    const trimmedTopic = topicInput.trim();
    if (!trimmedTopic) return;
    setSubtopic(trimmedTopic);
    setLessonStarted(true);
    setQuestionMode(false);
    setChatHistory([]);
    setStreamKey(k => k + 1);
  };

  const handleAskQuestion = () => {
    // Pause the lesson stream
    setQuestionMode(true);
  };

  const handleChatSend = async (message) => {
    // Confirmation check
    const confirmRes = await fetch('http://localhost:8000/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const { confirm } = await confirmRes.json();

    if (confirm) {
      // Student understood: resume lesson
      setChatHistory([]);
      setQuestionMode(false);
      return;
    }

    // Append student message
    const updatedHistory = [...chatHistory, { role: 'student', text: message }];
    setChatHistory(updatedHistory);

    // Send to chat endpoint
    const res = await fetch('http://localhost:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subtopic, history: updatedHistory, question: message })
    });

    let botText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      botText += decoder.decode(value);
    }

    setChatHistory(h => [...h, { role: 'bot', text: botText.trim() }]);
  };

  return (
    <div className="App" style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
      <h1 style={{ textAlign: 'center' }}>📚 AI Science Teacher</h1>

      {/* Topic Input */}
      {!lessonStarted && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <input
            type="text"
            placeholder="Enter a lesson topic (e.g., Photosynthesis)"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
          />
          <button
            onClick={handleStartLesson}
            disabled={!topicInput.trim()}
            style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}
          >
            Start Lesson
          </button>
        </div>
      )}

      {/* Lesson Stream with multimedia */}
      {lessonStarted && !questionMode && (
        <LessonStream
          key={streamKey}
          subtopic={subtopic}
          onAskQuestion={handleAskQuestion}
          questionMode={questionMode} // pass pause flag
        />
      )}

      {/* Chat Window for questions */}
      {lessonStarted && questionMode && (
        <ChatWindow history={chatHistory} onSend={handleChatSend} />
      )}
    </div>
  );
}

export default App;
