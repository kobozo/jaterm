import React from 'react';
import { readDir, mkdir, remove, DirEntry } from '@tauri-apps/plugin-fs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { resolvePathAbsolute } from '@/types/ipc';

type Props = {
  cwd?: string | null;
  onCwdChange?: (next: string) => void;
  onOpenFile?: (path: string) => void;
  isActive?: boolean;
  openFiles?: string[];
  activeFile?: string | null;
  modifiedFiles?: string[];
};

export default function LocalFilePanel({ 
  cwd, 
  onCwdChange, 
  onOpenFile, 
  isActive = true,
  openFiles = [],
  activeFile = null,
  modifiedFiles = []
}: Props) {
  const [path, setPath] = React.useState<string>('');
  const [entries, setEntries] = React.useState<DirEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [showHidden, setShowHidden] = React.useState<boolean>(false);
  const [newDirOpen, setNewDirOpen] = React.useState<boolean>(false);
  const [newDirName, setNewDirName] = React.useState<string>('');

  async function load(dir?: string) {
    setLoading(true);
    setErr(null);
    try {
      let cur = dir || path;
      if (!cur) {
        // Default to home directory or current working directory
        cur = cwd || await resolvePathAbsolute('~');
      }
      
      // Ensure absolute path
      cur = await resolvePathAbsolute(cur);
      
      // Read directory contents
      const list = await readDir(cur);
      
      // Sort entries: directories first, then files, alphabetically
      list.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
      setPath(cur);
      setEntries(list);
      onCwdChange?.(cur);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (isActive) void load(cwd || undefined);
  }, [isActive]);

  function join(a: string, b: string) {
    return (a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '')).replace(/\/+$/, '');
  }
  
  function parentDir(p: string) {
    const x = p.replace(/\/+$/, '').replace(/\/+[^/]+$/, '');
    return x || '/';
  }

  async function mkdirSubmit() {
    const name = (newDirName || '').trim();
    if (!name) {
      setNewDirOpen(false);
      setNewDirName('');
      return;
    }
    const full = join(path, name);
    setBusy(true);
    try {
      await mkdir(full);
      if (name.startsWith('.') && !showHidden) setShowHidden(true);
      await load(path);
    } catch (e) {
      alert('mkdir failed: ' + (e as any));
    } finally {
      setBusy(false);
      setNewDirOpen(false);
      setNewDirName('');
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      // For local file system, we'll copy files using Tauri commands
      alert('File upload to local directory not yet implemented');
      // TODO: Implement file copy functionality
    } catch (e) {
      alert('upload failed: ' + (e as any));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(entry: DirEntry) {
    if (!confirm(`Delete ${entry.name}?`)) return;
    setBusy(true);
    try {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory) {
        await remove(fullPath, { recursive: true });
      } else {
        await remove(fullPath);
      }
      await load(path);
    } catch (e) {
      alert('Delete failed: ' + (e as any));
    } finally {
      setBusy(false);
    }
  }

  const canNavigateUp = path && path !== '/';

  function nfIconFor(name: string, isDir: boolean): string {
    if (isDir) return ''; // folder
    const lower = name.toLowerCase();
    // Special filenames
    if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return '';
    if (lower === 'docker-compose.yml' || lower === 'docker-compose.yaml' || lower === 'compose.yml' || lower === 'compose.yaml') return '';
    if (lower === 'makefile' || lower === 'gnumakefile') return '';
    if (lower.startsWith('.git')) return '';
    if (lower === 'package.json' || lower === 'package-lock.json' || lower === 'yarn.lock' || lower === 'pnpm-lock.yaml') return '';
    if (lower.startsWith('tsconfig')) return '';
    if (lower.startsWith('.eslintrc')) return '';
    if (lower.startsWith('.prettier')) return '';
    if (lower === '.editorconfig') return '';
    if (lower === '.env' || lower.startsWith('.env.')) return '';
    if (lower === 'go.mod' || lower === 'go.sum') return '';
    if (lower === 'cargo.toml' || lower === 'cargo.lock') return '';
    if (lower === 'gemfile' || lower === 'gemfile.lock') return '';
    if (lower === 'requirements.txt' || lower === 'pipfile') return '';
    if (lower === 'composer.json' || lower === 'composer.lock') return '';
    if (lower.startsWith('.vscode')) return '';
    const ext = (lower.includes('.') ? lower.split('.').pop() : '') || '';
    // common types
    if (['md', 'mdx'].includes(ext)) return '';
    if (['js', 'mjs', 'cjs'].includes(ext)) return '';
    if (['ts'].includes(ext)) return '';
    if (['tsx', 'jsx'].includes(ext)) return '';
    if (['json'].includes(ext)) return '';
    if (['yml', 'yaml', 'toml', 'ini', 'conf', 'config'].includes(ext)) return '';
    if (['rs'].includes(ext)) return '';
    if (['go'].includes(ext)) return '';
    if (['py'].includes(ext)) return '';
    if (['rb'].includes(ext)) return '';
    if (['c', 'h'].includes(ext)) return '';
    if (['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'].includes(ext)) return '';
    if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) return '';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '';
    if (['html', 'htm'].includes(ext)) return '';
    if (['css', 'scss', 'sass', 'less'].includes(ext)) return '';
    if (['vue'].includes(ext)) return '﵂';
    if (['svelte'].includes(ext)) return '';
    if (['php'].includes(ext)) return '';
    if (['java'].includes(ext)) return '';
    if (['kt', 'kts'].includes(ext)) return '';
    if (['swift'].includes(ext)) return '';
    if (['lua'].includes(ext)) return '';
    if (['vim'].includes(ext)) return '';
    if (['pdf'].includes(ext)) return '';
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return '';
    if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '';
    if (['mp4', 'mkv', 'mov', 'webm'].includes(ext)) return '';
    if (['sql', 'db', 'sqlite'].includes(ext)) return '';
    if (['bat', 'ps1'].includes(ext)) return '';
    if (lower.endsWith('license')) return '';
    if (lower.endsWith('lock')) return '';
    return '';
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1a', color: '#ddd' }}>
      <div style={{ padding: '10px', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📁 {path || '/'}
        </div>
        <button 
          disabled={busy} 
          onClick={() => setNewDirOpen(true)} 
          style={{ fontSize: 11 }}
          title="Create Folder"
        >
          New Folder
        </button>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input 
            type="checkbox" 
            checked={showHidden} 
            onChange={(e) => setShowHidden(e.target.checked)} 
          />
          Hidden
        </label>
        <button 
          disabled={busy || loading} 
          onClick={() => load(path)} 
          title="Refresh"
        >
          🔄
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 10, color: '#aaa' }}>Loading…</div>
        ) : err ? (
          <div style={{ padding: 10, color: '#f88' }}>{err}</div>
        ) : (
          <div>
            <div 
              style={{ 
                padding: '6px 10px', 
                cursor: canNavigateUp ? 'pointer' : 'default', 
                color: canNavigateUp ? '#ddd' : '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }} 
              onClick={() => canNavigateUp && load(parentDir(path))}
            >
              <span className="nf-icon" style={{ width: 18, textAlign: 'center' }}>⬆</span>
              <span>..</span>
            </div>
            {entries
              .filter((e) => showHidden || !e.name.startsWith('.'))
              .map((e) => {
                const fullPath = join(path, e.name);
                const isOpen = openFiles.includes(fullPath);
                const isActive = activeFile === fullPath;
                const isModified = modifiedFiles.includes(fullPath);
                
                return (
                  <div 
                    key={e.name} 
                    style={{ 
                      padding: '6px 10px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 8,
                      background: isActive ? '#094771' : isOpen ? '#2a2a2a' : 'transparent',
                      borderLeft: isActive ? '2px solid #007acc' : '2px solid transparent'
                    }}
                    onMouseEnter={(ev) => { 
                      if (!isActive && !isOpen) ev.currentTarget.style.background = '#2a2a2a'; 
                    }}
                    onMouseLeave={(ev) => { 
                      if (!isActive && !isOpen) ev.currentTarget.style.background = 'transparent'; 
                    }}
                  >
                    <div 
                      style={{ 
                        flex: 1, 
                        cursor: e.isDirectory ? 'pointer' : 'default', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 8 
                      }} 
                      onClick={() => e.isDirectory && load(join(path, e.name))}
                      onDoubleClick={() => !e.isDirectory && onOpenFile?.(fullPath)}
                    >
                      <span className="nf-icon" style={{ width: 18, textAlign: 'center' }}>
                        {nfIconFor(e.name, e.isDirectory)}
                      </span>
                      <span style={{ 
                        fontWeight: isActive ? 'bold' : 'normal',
                        color: isActive ? '#fff' : isOpen ? '#e8e8e8' : '#ddd'
                      }}>
                        {e.name}
                      </span>
                      {isModified && !e.isDirectory && (
                        <span style={{ color: '#ffaa00', fontSize: 10 }}>●</span>
                      )}
                    </div>
                    {!e.isDirectory && (
                      <button 
                        disabled={busy} 
                        onClick={() => onOpenFile?.(fullPath)} 
                        title={isOpen ? "Go to File" : "Edit File"}
                        style={{ 
                          fontSize: 11,
                          background: isOpen ? '#0078d4' : 'transparent',
                          color: isOpen ? '#fff' : '#ddd',
                          padding: '2px 8px',
                          borderRadius: 3,
                          border: isOpen ? 'none' : '1px solid #555'
                        }}
                      >
                        {isOpen ? 'Open' : 'Edit'}
                      </button>
                    )}
                    <button 
                      disabled={busy} 
                      onClick={() => deleteEntry(e)} 
                      title={e.isDirectory ? 'Delete Folder' : 'Delete File'}
                      style={{ fontSize: 11, color: '#ff6666' }}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {newDirOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 360, border: '1px solid #444' }}>
            <h3 style={{ margin: 0, marginBottom: 8 }}>Create Folder</h3>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Parent: {path || '/'}</div>
            <form onSubmit={(e) => { e.preventDefault(); void mkdirSubmit(); }}>
              <input
                autoFocus
                placeholder="Folder name"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setNewDirOpen(false); setNewDirName(''); } }}
                style={{ width: '100%', padding: 8, background: '#2a2a2a', color: '#eee', border: '1px solid #444', borderRadius: 4, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setNewDirOpen(false); setNewDirName(''); }}>Cancel</button>
                <button type="submit" disabled={!newDirName.trim()}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}