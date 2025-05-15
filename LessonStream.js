import React, { useEffect, useState, useRef } from 'react';

const LessonStream = ({ subtopic, onAskQuestion }) => {
    const [elements, setElements] = useState([]);
    const [isFinished, setIsFinished] = useState(false);
    const socketRef = useRef(null);

    const seenImagesRef = useRef(new Set());
    const seenVideosRef = useRef(new Set());
    const seenWarningRef = useRef(false);
    const textBufferRef = useRef('');

    // Parse incoming chunks into React nodes
    const parseChunk = (chunk) => {
        const parts = chunk.split(/(<<image:[^>]+>>|<<video:[^>]+>>)/g);
        return parts.flatMap((seg) => {
            // Out-of-syllabus warning
            if (seg.includes("This topic seems to be outside the syllabus")) {
                if (seenWarningRef.current) return [];
                seenWarningRef.current = true;
                return [
                    <p key="warning" style={{ color: '#a00', fontWeight: 'bold', textAlign: 'center' }}>
                        {seg.trim()}
                    </p>
                ];
            }

            // Image embedding
            const imgMatch = seg.match(/<<image:\s*([^\s>]+)\s*>>/i);
            if (imgMatch) {
                const name = imgMatch[1];
                if (seenImagesRef.current.has(name)) return [];
                seenImagesRef.current.add(name);
                return [
                    <div key={`img-${name}`} style={{ textAlign: 'center', margin: '1em 0' }}>
                        <img
                            src={`http://localhost:8000/images/${name}`}
                            alt={name}
                            style={{ maxWidth: '100%', border: '1px solid #ccc', borderRadius: '4px' }}
                            onError={(e) => console.error(`Error loading image: ${e.target.src}`)}
                        />
                        <div style={{ fontSize: '0.9em', color: '#555', marginTop: '0.3em' }}>{name}</div>
                    </div>
                ];
            }

            // Video embedding
            const vidMatch = seg.match(/<<video:\s*([^\s>]+)\s*>>/);
            if (vidMatch) {
                const id = vidMatch[1];
                if (seenVideosRef.current.has(id)) return [];
                seenVideosRef.current.add(id);
                return [
                    <div key={`vid-${id}`} style={{ margin: '1em 0' }}>
                        <iframe
                            width="560"
                            height="315"
                            src={`https://www.youtube.com/embed/${id}`}
                            title="Lesson video"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            onError={(e) => console.error(`Error loading video: ${e.target.src}`)}
                        />
                    </div>
                ];
            }

            // Plain text
            if (seg && seg.trim()) {
                return [<p key={`txt-${Math.random().toString(36).substr(2, 9)}`}>{seg}</p>];
            }

            return [];
        });
    };

    // WebSocket effect
    useEffect(() => {
        seenImagesRef.current.clear();
        seenVideosRef.current.clear();
        seenWarningRef.current = false;
        textBufferRef.current = '';
        setElements([]);
        setIsFinished(false);

        const socket = new WebSocket('ws://localhost:8000/ws/lesson');
        socketRef.current = socket;

        socket.onopen = () => {
            console.log('WebSocket connected');
            socket.send(JSON.stringify({ subtopic }));
        };

        socket.onmessage = ({ data }) => {
            if (data === '[DONE]') {
                setIsFinished(true);
                socketRef.current?.close();
                return;
            }

            textBufferRef.current += data;
            let buffer = textBufferRef.current;

            const lastImg = buffer.lastIndexOf('<<image:');
            const lastVid = buffer.lastIndexOf('<<video:');
            const lastOpen = Math.max(lastImg, lastVid);

            let processStr = buffer;
            let leftover = '';

            if (lastOpen !== -1) {
                const closingIdx = buffer.indexOf('>>', lastOpen);
                if (closingIdx === -1) {
                    processStr = buffer.substring(0, lastOpen);
                    leftover = buffer.substring(lastOpen);
                }
            }

            textBufferRef.current = leftover;
            const newNodes = parseChunk(processStr);
            setElements(prev => [...prev, ...newNodes]);
        };

        socket.onerror = (err) => console.error('WebSocket error', err);
        socket.onclose = () => {
            console.log('WebSocket closed');
            socketRef.current = null;
        };

        return () => {
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.close();
            }
        };
    }, [subtopic]);

    return (
        <div className="lesson-stream" style={{ position: 'relative' }}>
            <button
                onClick={onAskQuestion}
                style={{ position: 'absolute', top: '1em', right: '1em', zIndex: 10 }}
            >
                Ask Question
            </button>
            {elements}
            {isFinished && (
                <div style={{ marginTop: '2em', padding: '1em', borderTop: '1px solid #ccc', textAlign: 'center' }}>
                    <h2>🎉 Lesson Complete!</h2>
                    <p>Key takeaways above!</p>
                </div>
            )}
        </div>
    );
};

export default LessonStream;
