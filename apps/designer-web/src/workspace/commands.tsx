import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { CommandItem } from '@verbis/ui';

/** Builds a page's commands for the current palette query. Called only while the palette is open. */
export type CommandSource = (query: string) => readonly CommandItem[];

export interface CommandRegistry {
  register: (id: string, source: CommandSource) => () => void;
  sources: () => readonly CommandSource[];
}
const CommandRegistryContext = createContext<CommandRegistry | null>(null);

/**
 * One ⌘K palette for the whole workspace (DIFFERENTIATORS A2). Pages contribute contextual
 * commands that lead the list while they are mounted. Sources are read lazily, so a busy page
 * such as the editor never re-renders the shell on each edit.
 */
export function useCommandRegistry(): CommandRegistry {
  const [registry] = useState<CommandRegistry>(() => {
    const entries = new Map<string, CommandSource>();
    return {
      register: (id, source) => {
        entries.set(id, source);
        return () => {
          if (entries.get(id) === source) entries.delete(id);
        };
      },
      sources: () => [...entries.values()],
    };
  });
  return registry;
}

export function CommandRegistryProvider({
  registry,
  children,
}: {
  registry: CommandRegistry;
  children: ReactNode;
}) {
  return (
    <CommandRegistryContext.Provider value={registry}>{children}</CommandRegistryContext.Provider>
  );
}

/** Contribute commands while mounted; `build` always sees the caller's latest render. */
export function useContributeCommands(id: string, build: CommandSource): void {
  const registry = useContext(CommandRegistryContext);
  const latest = useRef(build);
  useEffect(() => {
    latest.current = build;
  });
  useEffect(() => {
    if (!registry) return undefined;
    return registry.register(id, (query) => latest.current(query));
  }, [registry, id]);
}

const RECENT_LIMIT = 5;
export function readRecentCommands(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function writeRecentCommand(key: string, id: string): string[] {
  const next = [id, ...readRecentCommands(key).filter((value) => value !== id)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* A per-viewer convenience only. */
  }
  return next;
}
