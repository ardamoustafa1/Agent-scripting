/** Strongly connected components (iterative Tarjan). Deterministic: follows insertion order. */
export function stronglyConnectedComponents(
  vertices: readonly string[],
  successors: (vertex: string) => readonly string[],
): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const lowOf = (vertex: string): number => low.get(vertex) ?? Number.POSITIVE_INFINITY;

  const visit = (vertex: string): void => {
    index.set(vertex, counter);
    low.set(vertex, counter);
    counter += 1;
    stack.push(vertex);
    onStack.add(vertex);
  };

  for (const root of vertices) {
    if (index.has(root)) continue;
    visit(root);
    const work: { vertex: string; edges: readonly string[]; next: number }[] = [
      { vertex: root, edges: successors(root), next: 0 },
    ];

    for (let frame = work.at(-1); frame !== undefined; frame = work.at(-1)) {
      const target = frame.edges[frame.next];
      if (target !== undefined) {
        frame.next += 1;
        const targetIndex = index.get(target);
        if (targetIndex === undefined) {
          visit(target);
          work.push({ vertex: target, edges: successors(target), next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.vertex, Math.min(lowOf(frame.vertex), targetIndex));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined)
        low.set(parent.vertex, Math.min(lowOf(parent.vertex), lowOf(frame.vertex)));
      if (lowOf(frame.vertex) === index.get(frame.vertex)) {
        const component: string[] = [];
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
          onStack.delete(member);
          component.push(member);
          if (member === frame.vertex) break;
        }
        components.push(component.reverse());
      }
    }
  }
  return components;
}

/** Components that form a cycle: more than one vertex, or a self-loop. */
export function cycles(
  vertices: readonly string[],
  successors: (vertex: string) => readonly string[],
): string[][] {
  return stronglyConnectedComponents(vertices, successors).filter(
    ([first, ...rest]) =>
      first !== undefined && (rest.length > 0 || successors(first).includes(first)),
  );
}

/** Breadth-first reachable set. */
export function reachable<T extends string>(
  roots: Iterable<T>,
  successors: (vertex: T) => Iterable<T>,
): Set<T> {
  const seen = new Set<T>();
  const queue = [...roots];
  for (let vertex = queue.shift(); vertex !== undefined; vertex = queue.shift()) {
    if (seen.has(vertex)) continue;
    seen.add(vertex);
    for (const next of successors(vertex)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}
