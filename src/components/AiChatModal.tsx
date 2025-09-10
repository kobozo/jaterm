import React, { useState, useEffect, useRef } from 'react';
import { aiService } from '@/services/ai';
import { useToasts } from '@/store/toasts';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  hasCliSolution?: boolean;
}

interface AiChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialBuffer: string;
  onInsertCommand?: (command: string) => void;
}

export const AiChatModal: React.FC<AiChatModalProps> = ({ 
  isOpen, 
  onClose, 
  initialBuffer,
  onInsertCommand 
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [showGenerateSolution, setShowGenerateSolution] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { show } = useToasts();

  // Initialize chat when modal opens
  useEffect(() => {
    if (isOpen && initialBuffer && !chatId) {
      initializeChat();
    }
  }, [isOpen, initialBuffer]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const initializeChat = async () => {
    setIsLoading(true);
    try {
      const response = await aiService.startChat(initialBuffer);
      setChatId(response.chatId);
      
      // Add initial messages
      setMessages([
        {
          role: 'system',
          content: 'Terminal output captured for analysis',
          timestamp: new Date()
        },
        {
          role: 'assistant',
          content: response.analysis,
          timestamp: new Date(),
          hasCliSolution: response.hasCliSolution
        }
      ]);
      
      setShowGenerateSolution(response.hasCliSolution || false);
    } catch (error) {
      show({
        title: 'Failed to start AI chat',
        message: String(error),
        kind: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !chatId || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    
    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    setIsLoading(true);
    try {
      const response = await aiService.sendChatMessage(chatId, userMessage);
      
      // Add AI response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
        hasCliSolution: response.hasCliSolution
      }]);
      
      // Update solution button visibility
      if (response.hasCliSolution) {
        setShowGenerateSolution(true);
      }
    } catch (error) {
      show({
        title: 'Failed to send message',
        message: String(error),
        kind: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generateCliSolution = async () => {
    if (!chatId || isLoading) return;

    setIsLoading(true);
    try {
      const solution = await aiService.generateCliSolution(chatId);
      
      // Add solution as a message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `CLI Solution:\n\`\`\`bash\n${solution.command}\n\`\`\`\n\n${solution.explanation}`,
        timestamp: new Date()
      }]);

      // Optionally insert the command
      if (onInsertCommand && solution.command) {
        show({
          title: 'Command ready',
          message: 'Click "Insert Command" to send it to the terminal',
          kind: 'info',
          actions: [{
            label: 'Insert Command',
            action: () => {
              onInsertCommand(solution.command);
              show({
                title: 'Command inserted',
                message: 'Command has been sent to the terminal',
                kind: 'success'
              });
            }
          }]
        });
      }
    } catch (error) {
      show({
        title: 'Failed to generate solution',
        message: String(error),
        kind: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        width: '80%',
        maxWidth: '800px',
        height: '70%',
        maxHeight: '600px',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #333'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, color: '#fff' }}>🤖 AI Terminal Analysis</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#999',
              fontSize: '24px',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {messages.map((msg, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              <div style={{
                maxWidth: '70%',
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: msg.role === 'user' ? '#2563eb' : 
                                msg.role === 'system' ? '#444' : '#333',
                color: '#fff'
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  opacity: 0.7,
                  marginBottom: '4px'
                }}>
                  {msg.role === 'user' ? 'You' : 
                   msg.role === 'system' ? 'System' : 'AI Assistant'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#999'
            }}>
              <span>AI is thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{
          padding: '16px',
          borderTop: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {showGenerateSolution && (
            <button
              onClick={generateCliSolution}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.5 : 1
              }}
            >
              🔧 Generate CLI Solution
            </button>
          )}
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or describe the issue..."
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '8px',
                backgroundColor: '#2a2a2a',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                resize: 'none',
                minHeight: '40px',
                maxHeight: '100px'
              }}
              rows={1}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: (!input.trim() || isLoading) ? 'not-allowed' : 'pointer',
                opacity: (!input.trim() || isLoading) ? 0.5 : 1
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};