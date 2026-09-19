import type {
  BaseAssetPort,
  BaseIndustryInitPort,
  BasePrincipal,
  ContentCatalogPort,
  ProvisionUseCase,
  RobotFactoryPort
} from "./ports.js";
import type { BaseService, BaseServiceDeps } from "../../modules/world-runtime/base.service.js";

// M12-A：provision 用例薄壳。构造收 world.base 的 BaseService（application → world
// 允许边），真实端口绑定（BaseAssetPort/RobotFactoryPort/BaseIndustryInitPort/
// ContentCatalogPort）由 composition（M12-I）注入 BaseServiceDeps。

// 编译期防漂移：冻结端口必须结构兼容服务镜像端口（width 子类型，多出的成员允许）。
type Assert<T extends true> = T;
type AssetsCompatible = Assert<BaseAssetPort extends BaseServiceDeps["assets"] ? true : false>;
type RobotsCompatible = Assert<RobotFactoryPort extends BaseServiceDeps["robots"] ? true : false>;
type IndustryInitCompatible = Assert<
  BaseIndustryInitPort extends BaseServiceDeps["industryInit"] ? true : false
>;
type CatalogCompatible = Assert<ContentCatalogPort extends BaseServiceDeps["catalog"] ? true : false>;

type _CompatibilityWitness = [
  AssetsCompatible,
  RobotsCompatible,
  IndustryInitCompatible,
  CatalogCompatible
];

export class ProvisionBaseUseCase implements ProvisionUseCase {
  constructor(private readonly service: BaseService) {}

  execute(
    principal: BasePrincipal,
    input: { commandId: string }
  ): Promise<{ baseId: string; duplicate: boolean }> {
    return this.service.provision(principal, input);
  }
}
