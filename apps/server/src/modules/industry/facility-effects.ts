// R1 A 包：设施完工的有类型效果应用（03-domain-contracts.md §2「设施效果为有类型的
// 有限字段」）。完工事务内：消耗全部预留物料 → 站点 built → 发电/容量/充电上限/
// 加工槽按效果落盘。效果幂等由「站点只有 free→reserved→built 一次迁移 +
// hasLiveOrCompletedProject 一次建成」保证；这里不再各自判重。
import type { ProjectTemplateDto } from "@ai-mud/shared";
import { definitionRefKey } from "@ai-mud/shared";

export interface FacilityEffectsWriterPort {
  markSiteBuilt(tx: FacilityEffectsTx, siteId: string, facilityRef: string): Promise<void>;
  addGenerationWPeak(tx: FacilityEffectsTx, baseId: string, deltaW: number): Promise<void>;
  addStorageCapacityWh(tx: FacilityEffectsTx, baseId: string, deltaWh: number): Promise<void>;
  addChargeLimitW(tx: FacilityEffectsTx, baseId: string, deltaW: number): Promise<void>;
  insertProductionSlots(
    tx: FacilityEffectsTx,
    baseId: string,
    siteId: string,
    count: number
  ): Promise<void>;
}

export type FacilityEffectsTx = object;

export interface FacilityEffectsAssetsPort {
  consumeReservedBaseInventory(
    tx: FacilityEffectsTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
}

export async function applyProjectCompletionEffects(input: {
  tx: FacilityEffectsTx;
  baseId: string;
  siteId: string;
  template: Pick<ProjectTemplateDto, "outputFacility">;
  reservedInputs: ReadonlyArray<{ itemId: string; quantity: number }>;
  writer: FacilityEffectsWriterPort;
  assets: FacilityEffectsAssetsPort;
}): Promise<void> {
  const { tx, baseId, siteId, template, reservedInputs, writer, assets } = input;
  for (const item of reservedInputs) {
    await assets.consumeReservedBaseInventory(tx, baseId, item.itemId, item.quantity);
  }
  await writer.markSiteBuilt(tx, siteId, definitionRefKey(template.outputFacility.ref));
  const effects = template.outputFacility.effects;
  if (template.outputFacility.generationWPeak !== undefined) {
    await writer.addGenerationWPeak(tx, baseId, template.outputFacility.generationWPeak);
  }
  if (!effects) return;
  if (effects.storageCapacityWh !== undefined) {
    // 储能扩容不发电：只加容量，存量不变（新增容量初始为空）。
    await writer.addStorageCapacityWh(tx, baseId, effects.storageCapacityWh);
  }
  if (effects.chargeLimitW !== undefined) {
    await writer.addChargeLimitW(tx, baseId, effects.chargeLimitW);
  }
  if (effects.processingSlots !== undefined && effects.processingSlots > 0) {
    await writer.insertProductionSlots(tx, baseId, siteId, effects.processingSlots);
  }
}

// 从已建成站点的 facilityRef（"facility:stableId@rev"）解析 stableId。
export function facilityStableIdFromRef(builtFacilityRef: string): string {
  return builtFacilityRef.split(":")[1]?.split("@")[0] ?? "";
}

// 能力位派生：已建成设施（stableId 集合）× 项目模板 outputFacility.effects.capabilities。
export function collectCapabilities(
  builtFacilityStableIds: ReadonlySet<string>,
  projects: ReadonlyArray<Pick<ProjectTemplateDto, "outputFacility">>
): Set<string> {
  const capabilities = new Set<string>();
  for (const project of projects) {
    const stableId = project.outputFacility.ref.stableId;
    if (!builtFacilityStableIds.has(stableId)) continue;
    for (const capability of project.outputFacility.effects?.capabilities ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}
