import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const AssistantPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    let assistantContent = '';
    const updateAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
        }
        return [...prev, { role: 'assistant', content: assistantContent }];
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: newMessages, userId: user?.id }),
      });

      if (!resp.ok || !resp.body) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erreur de l\'assistant');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) updateAssistant(content);
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }
    } catch (err: any) {
      updateAssistant(`[Error] ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Assistant IA</h1>
            <p className="text-sm text-muted-foreground">Interrogez vos données projets, audits et rapports</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setMessages([])}>
            <Trash2 className="w-3 h-3 mr-1" /> Nouvelle conversation
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto glass-card p-6 space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-4 text-primary/30" />
            <p className="text-lg font-medium mb-2">Bienvenue sur l'Assistant Snapflow</p>
            <p className="text-sm">Je peux vous aider à analyser vos projets, comprendre vos audits et suivre vos rapports.</p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {[
                'Quel est l\'état de mes projets ?',
                'Résumé des derniers audits',
                'Quels rapports sont planifiés ?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[80%] rounded-xl px-4 py-3',
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            )}
          >
            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            L'assistant réfléchit…
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-3">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Posez votre question sur vos projets…"
          className="flex-1"
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          <Send className="w-4 h-4 mr-2" /> Envoyer
        </Button>
      </form>
    </div>
  );
};

export default AssistantPage;
