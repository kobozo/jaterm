import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Fuse from 'fuse.js';
import { Command, CommandCategory } from '@/types/commands';
import { commandRegistry } from '@/services/commandRegistry';
import { useToasts } from '@/store/toasts';
import { aiService } from '@/services/ai';
import { CommandSuggestion } from '@/types/ai';
import { ptyWrite, sshWrite } from '@/types/ipc';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  activePaneId: string | null;
  paneKind?: string;
}

const categoryIcons: Record<CommandCategory, string> = {
  [CommandCategory.Terminal]: '⌨️',
  [CommandCategory.SSH]: '🔐',
  [CommandCategory.Git]: '🔀',
  [CommandCategory.Settings]: '⚙️',
  [CommandCategory.Theme]: '🎨',
  [CommandCategory.Ports]: '🔌',
  [CommandCategory.Session]: '💾',
  [CommandCategory.View]: '👁️',
  [CommandCategory.File]: '📁',
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, activePaneId, paneKind }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allCommands, setAllCommands] = useState<Command[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);
  const [recentCommands, setRecentCommands] = useState<Command[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [navigationStack, setNavigationStack] = useState<{ commands: Command[], query: string }[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<CommandSuggestion[]>([]);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { show } = useToasts();

  // Load commands from registry
  useEffect(() => {
    const loadCommands = () => {
      const commands = commandRegistry.getEnabled();
      setAllCommands(commands);
      const recent = commandRegistry.getRecentCommands(5);
      setRecentCommands(recent);
    };

    loadCommands();
    const unsubscribe = commandRegistry.onChange(loadCommands);
    return unsubscribe;
  }, []);

  // Initialize Fuse for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(allCommands, {
      keys: ['label', 'category', 'keywords', 'description'],
      threshold: 0.3,
      includeScore: true,
      shouldSort: true,
    });
  }, [allCommands]);

  // Filter commands based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      // Show recent commands when no search
      const categorized = groupCommandsByCategory(allCommands);
      if (recentCommands.length > 0) {
        setFilteredCommands([...recentCommands, ...categorized]);
      } else {
        setFilteredCommands(categorized);
      }
      setSelectedIndex(0);
      setAiPrompt('');
      setAiSuggestions([]);
      return;
    }

    // Handle search prefixes
    let query = searchQuery;
    let filtered: Command[] = [];

    if (query.startsWith('>')) {
      // Commands only (default behavior)
      query = query.substring(1).trim();
    } else if (query.startsWith(':')) {
      // Settings commands
      query = query.substring(1).trim();
      const settingsCommands = allCommands.filter(
        cmd => cmd.category === CommandCategory.Settings
      );
      const settingsFuse = new Fuse(settingsCommands, {
        keys: ['label', 'keywords', 'description'],
        threshold: 0.3,
      });
      filtered = query ? settingsFuse.search(query).map(r => r.item) : settingsCommands;
    } else if (query.startsWith('@')) {
      // SSH commands
      query = query.substring(1).trim();
      const sshCommands = allCommands.filter(
        cmd => cmd.category === CommandCategory.SSH
      );
      const sshFuse = new Fuse(sshCommands, {
        keys: ['label', 'keywords', 'description'],
        threshold: 0.3,
      });
      filtered = query ? sshFuse.search(query).map(r => r.item) : sshCommands;
    } else if (query.startsWith('?')) {
      // Git commands (changed from # to ?)
      query = query.substring(1).trim();
      const gitCommands = allCommands.filter(
        cmd => cmd.category === CommandCategory.Git
      );
      const gitFuse = new Fuse(gitCommands, {
        keys: ['label', 'keywords', 'description'],
        threshold: 0.3,
      });
      filtered = query ? gitFuse.search(query).map(r => r.item) : gitCommands;
    } else if (query.startsWith('#')) {
      // AI command generation
      query = query.substring(1).trim();
      setAiPrompt(query);
      // Don't show regular commands, AI suggestions will be shown
      filtered = [];
    } else {
      // Regular fuzzy search
      filtered = fuse.search(query).map(result => result.item);
      setAiPrompt('');
      setAiSuggestions([]);
    }

    setFilteredCommands(filtered);
    setSelectedIndex(0);
  }, [searchQuery, allCommands, fuse, recentCommands]);

  // Generate AI suggestions when prompt changes
  useEffect(() => {
    if (!aiPrompt || aiPrompt.length < 3) {
      setAiSuggestions([]);
      return;
    }

    // Debounce the AI generation
    const timer = setTimeout(async () => {
      setIsGeneratingAi(true);
      try {
        const suggestions = await aiService.generateCommand(aiPrompt, true);
        setAiSuggestions(suggestions);
        
        // Convert AI suggestions to commands for display
        const aiCommands: Command[] = suggestions.map((suggestion, index) => ({
          id: `ai.suggestion.${index}`,
          label: suggestion.command,
          category: CommandCategory.Terminal,
          icon: suggestion.safetyLevel === 'dangerous' ? '⚠️' : '🤖',
          description: suggestion.explanation,
          keywords: [],
          action: async () => {
            // Write command to active terminal
            if (activePaneId) {
              try {
                if (paneKind === 'ssh') {
                  await sshWrite({ channelId: activePaneId, data: suggestion.command });
                } else {
                  await ptyWrite({ ptyId: activePaneId, data: suggestion.command });
                }
                show({ 
                  title: 'Command sent', 
                  message: 'Command has been sent to terminal',
                  kind: 'success' 
                });
              } catch (error) {
                show({ 
                  title: 'Failed to send command', 
                  message: String(error),
                  kind: 'error' 
                });
              }
            } else {
              // Fallback to clipboard if no active terminal
              if (navigator.clipboard) {
                await navigator.clipboard.writeText(suggestion.command);
                show({ 
                  title: 'Command copied', 
                  message: 'No active terminal. Command copied to clipboard',
                  kind: 'info' 
                });
              }
            }
            onClose();
          }
        }));
        
        setFilteredCommands(aiCommands);
      } catch (error) {
        console.error('AI generation failed:', error);
        show({ 
          title: 'AI generation failed', 
          message: String(error),
          kind: 'error' 
        });
      } finally {
        setIsGeneratingAi(false);
      }
    }, 500); // Debounce for 500ms

    return () => clearTimeout(timer);
  }, [aiPrompt, show, onClose]);

  // Group commands by category
  const groupCommandsByCategory = (commands: Command[]): Command[] => {
    const grouped = new Map<CommandCategory, Command[]>();
    
    commands.forEach(cmd => {
      const category = cmd.category;
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(cmd);
    });

    const result: Command[] = [];
    grouped.forEach((cmds) => {
      result.push(...cmds);
    });
    
    return result;
  };

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          // If we have a navigation stack, go back
          if (navigationStack.length > 0) {
            const previous = navigationStack[navigationStack.length - 1];
            setNavigationStack(prev => prev.slice(0, -1));
            
            // Reload main commands if going back to root
            if (navigationStack.length === 1) {
              const commands = commandRegistry.getEnabled();
              setAllCommands(commands);
              setFilteredCommands(previous.commands);
              const recent = commandRegistry.getRecentCommands(5);
              setRecentCommands(recent);
            } else {
              setAllCommands(previous.commands);
              setFilteredCommands(previous.commands);
              setRecentCommands([]);
            }
            
            setSearchQuery(previous.query);
            setSelectedIndex(0);
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands, onClose]);

  // Auto-scroll to selected item
  useEffect(() => {
    const selectedItem = itemRefs.current[selectedIndex];
    if (selectedItem && listRef.current) {
      const listRect = listRef.current.getBoundingClientRect();
      const itemRect = selectedItem.getBoundingClientRect();
      
      if (itemRect.bottom > listRect.bottom) {
        selectedItem.scrollIntoView({ block: 'end', behavior: 'smooth' });
      } else if (itemRect.top < listRect.top) {
        selectedItem.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setSearchQuery('');
      setSelectedIndex(0);
      setNavigationStack([]);
    }
  }, [isOpen]);

  const executeCommand = useCallback(async (command: Command) => {
    if (isExecuting) return;
    
    // Check if command has subCommands
    if (command.subCommands) {
      setIsExecuting(true);
      try {
        const subCommands = await command.subCommands();
        if (subCommands.length > 0) {
          // Push current state to navigation stack
          setNavigationStack(prev => [...prev, { commands: filteredCommands, query: searchQuery }]);
          // Show subcommands
          setAllCommands(subCommands);
          setFilteredCommands(subCommands);
          setSearchQuery('');
          setSelectedIndex(0);
          setRecentCommands([]);
        }
      } catch (error) {
        show({
          title: 'Failed to load options',
          message: error instanceof Error ? error.message : 'Unknown error',
          kind: 'error',
        });
      } finally {
        setIsExecuting(false);
      }
      return;
    }
    
    setIsExecuting(true);
    try {
      // Check if this is a dynamically created command (from subCommands)
      // These won't be in the registry, so execute directly
      if (navigationStack.length > 0 && command.action) {
        await command.action();
        onClose();
      } else {
        // Regular command - execute through registry
        await commandRegistry.execute(command.id);
        onClose();
      }
    } catch (error) {
      show({
        title: 'Command failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        kind: 'error',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [isExecuting, onClose, show, filteredCommands, searchQuery, navigationStack]);

  if (!isOpen) return null;

  const renderCommand = (command: Command, index: number, isRecent = false) => {
    const isSelected = index === selectedIndex;
    const icon = categoryIcons[command.category] || '📋';
    
    return (
      <div
        key={`${isRecent ? 'recent-' : ''}${command.id}`}
        ref={el => itemRefs.current[index] = el}
        onClick={() => executeCommand(command)}
        onMouseEnter={() => setSelectedIndex(index)}
        style={{
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
          cursor: 'pointer',
          borderLeft: isSelected ? '2px solid #0078d4' : '2px solid transparent',
        }}
      >
        <span style={{ fontSize: '16px', width: '20px', textAlign: 'center' }}>
          {icon}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            color: '#fff',
          }}>
            <span>{command.label}</span>
            {isRecent && (
              <span style={{ 
                fontSize: '10px', 
                padding: '2px 6px', 
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                color: '#999',
              }}>
                RECENT
              </span>
            )}
          </div>
          {command.description && (
            <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
              {command.description}
            </div>
          )}
        </div>
        {command.shortcut && (
          <kbd style={{
            padding: '2px 6px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#999',
            fontFamily: 'monospace',
          }}>
            {command.shortcut}
          </kbd>
        )}
      </div>
    );
  };

  const showRecentSection = !searchQuery && recentCommands.length > 0;
  const mainCommands = showRecentSection 
    ? filteredCommands.filter(cmd => !recentCommands.includes(cmd))
    : filteredCommands;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: '80%',
          maxWidth: '800px',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          border: '1px solid #333',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Search Input */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #333',
        }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              navigationStack.length > 0 
                ? "Select an option..." 
                : isGeneratingAi 
                  ? "Generating AI suggestions..." 
                  : "Type to search commands... (> commands, : settings, @ SSH, ? Git, # AI)"
            }
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              backgroundColor: '#2d2d2d',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#fff',
              outline: 'none',
            }}
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {filteredCommands.length === 0 ? (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              color: '#999',
            }}>
              {searchQuery ? 'No commands found' : 'No commands available'}
            </div>
          ) : (
            <>
              {showRecentSection && (
                <>
                  <div style={{
                    padding: '8px 16px',
                    color: '#999',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #333',
                  }}>
                    Recent Commands
                  </div>
                  {recentCommands.map((cmd, idx) => renderCommand(cmd, idx, true))}
                  
                  {mainCommands.length > 0 && (
                    <div style={{
                      padding: '8px 16px',
                      color: '#999',
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      borderBottom: '1px solid #333',
                      marginTop: '8px',
                    }}>
                      All Commands
                    </div>
                  )}
                </>
              )}
              
              {mainCommands.map((cmd, idx) => {
                const actualIndex = showRecentSection ? idx + recentCommands.length : idx;
                return renderCommand(cmd, actualIndex, false);
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '12px',
          color: '#999',
        }}>
          <div>
            <kbd>↑↓</kbd> Navigate • <kbd>Enter</kbd> Execute • <kbd>Esc</kbd> {navigationStack.length > 0 ? 'Back' : 'Close'}
          </div>
          <div>
            {filteredCommands.length} command{filteredCommands.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
};