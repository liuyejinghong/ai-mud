import type {
  BaseAssetPort,
  BaseIndustryReadPort,
  BasePrincipal,
  BaseRobotReadPort,
  ContentCatalogPort,
  SnapshotUseCase
} from "./ports.js";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import type { BaseService, BaseServiceDeps } from "../../modules/world-runtime/base.service.js";

// M12-A：快照装配用例薄壳（A0-04 修正 7：装配者=application/base-snapshot.ts，
// world.base 仅为组成提供方）。industryRead/robotRead 由 M12-B 实现、I 绑定；
// resources 走 BaseAssetPort.listBaseInventory；sites 走 world 自己的 repo。

// 编译期防漂移：冻结端口必须结构兼容服务镜像端口。
type Assert<T extends true> = T;
type AssetsCompatible = Assert<BaseAssetPort extends BaseServiceDeps["assets"] ? true : false>;
type CatalogCompatible = Assert<ContentCatalogPort extends BaseServiceDeps["catalog"] ? true : false>;
type IndustryReadCompatible = Assert<
  BaseIndustryReadPort extends BaseServiceDeps["industryRead"] ? true : false
>;
type RobotReadCompatible = Assert<
  BaseRobotReadPort extends BaseServiceDeps["robotRead"] ? true : false
>;

type _CompatibilityWitness = [
  AssetsCompatible,
  CatalogCompatible,
  IndustryReadCompatible,
  RobotReadCompatible
];

export class BaseSnapshotUseCase implements SnapshotUseCase {
  constructor(private readonly service: BaseService) {}

  execute(principal: BasePrincipal, controlToken?: string): Promise<BaseSnapshotDto> {
    return this.service.snapshot(principal, controlToken);
  }
}
