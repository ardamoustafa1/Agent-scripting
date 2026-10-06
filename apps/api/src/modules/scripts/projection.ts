import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

/** Script documents are plain JSON by contract (validated by @verbis/script-schema). */
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * Projects a version's document into the screens/components/flows/variables read models
 * (DOMAIN Screen/Component/Flow/Variable) inside the same transaction.
 */
export async function projectDocument(
  tx: TransactionClient,
  scope: { tenantId: string; scriptVersionId: string; actor: string },
  document: ScriptDocument,
): Promise<{ screens: number; components: number; flows: number; variables: number }> {
  const audit = { tenantId: scope.tenantId, createdBy: scope.actor, updatedBy: scope.actor };
  const entryPage = (() => {
    const start = document.flow.nodes.find((node) => node.id === document.flow.start);
    return start?.type === 'page' ? start.page : undefined;
  })();

  const screens = await tx.screen.createManyAndReturn({
    data: document.pages.map((page) => ({
      ...audit,
      scriptVersionId: scope.scriptVersionId,
      key: page.id,
      title: page.titleKey ?? page.name,
      layoutRoot: toJson(page.layout),
      entry: page.id === entryPage,
    })),
    select: { id: true, key: true },
  });
  const screenIds = new Map(screens.map((screen) => [screen.key, screen.id]));

  const components: Prisma.ComponentCreateManyInput[] = [];
  walkNodes(document, ({ node, pageId }) => {
    const screenId = screenIds.get(pageId);
    if (screenId !== undefined) {
      components.push({
        ...audit,
        screenId,
        key: node.id,
        type: node.type,
        props: node.props,
        bindings: node.bindings,
        events: node.events,
      });
    }
    return true;
  });
  if (components.length > 0) await tx.component.createMany({ data: components });

  const flows = [document.flow, ...document.subflows];
  await tx.flow.createMany({
    data: flows.map((flow) => ({
      ...audit,
      scriptVersionId: scope.scriptVersionId,
      key: flow.id,
      nodes: flow.nodes,
      edges: flow.edges,
      trigger: { start: flow.start },
    })),
  });

  if (document.variables.length > 0) {
    await tx.variable.createMany({
      data: document.variables.map((variable) => ({
        ...audit,
        scriptVersionId: scope.scriptVersionId,
        name: variable.key,
        type: variable.type,
        scope: variable.scope,
        classification: variable.classification,
        // Sensitive defaults never enter plaintext read models.
        ...(variable.default === undefined ||
        variable.classification === 'pci' ||
        variable.classification === 'pii' ||
        variable.pii
          ? {}
          : { defaultValue: variable.default as Prisma.InputJsonValue }),
      })),
    });
  }
  return {
    screens: document.pages.length,
    components: components.length,
    flows: flows.length,
    variables: document.variables.length,
  };
}
