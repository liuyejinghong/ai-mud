// M16-A/B 订单经济薄用例：只负责事务边界（db.transaction 包 service）；业务语义在
// economy.order / economy.purchase（m16-p-contract.md §1—§3）。另把 BaseOperationError
// 与 catalog 端口形状再导出给 transport 路由（transport 仅可 import application）。
//
// I 绑定说明（M16-A/B → M16-I）：
//   createEconomyUseCases(db, catalog) —— catalog 传 content-catalog 扩展后的订单模板
//   读取实现（getOrderTemplate / listOrderTemplates，见 EconomyCatalogPort）。省略时使用
//   NULL 占位（getOrderTemplate 恒 null → accept 报 CONTENT_INCOMPATIBLE；
//   listOrderTemplates 恒 [] → ensureOrders 不开单），便于在无内容单时先行接线。
//   content-catalog 文件不在 M16-A/B 白名单，订单模板真实现由 I 合并 release payload
//   的 order_templates 数组时提供（M16-P §1）。
import type { Db } from "../../db/client.js";
import { AssetMutationService } from "../../modules/ledger/asset-mutation.service.js";
import { OrderRepository } from "../../modules/economy/order.repository.js";
import {
  BaseOperationError,
  OrderService,
  type AcceptOrderResultPayload,
  type DeliverOrderResultPayload,
  type EconomyCatalogPort,
  type EconomyPrincipal
} from "../../modules/economy/order.service.js";
import { PurchaseRepository } from "../../modules/economy/purchase.repository.js";
import {
  PurchaseService,
  type CreatePurchaseResultPayload
} from "../../modules/economy/purchase.service.js";
import { BaseRepository } from "../../modules/world-runtime/base.repository.js";

export { BaseOperationError };
export type { EconomyCatalogPort, EconomyPrincipal };

export interface AcceptOrderInput {
  orderId: string;
  commandId: string;
}

export interface CreatePurchaseInput {
  itemId: string;
  quantity: number;
  commandId: string;
}

export interface AcceptOrderUseCase {
  execute(principal: EconomyPrincipal, input: AcceptOrderInput): Promise<AcceptOrderResultPayload>;
}

export interface DeliverOrderUseCase {
  execute(principal: EconomyPrincipal, input: AcceptOrderInput): Promise<DeliverOrderResultPayload>;
}

export interface CreatePurchaseUseCase {
  execute(principal: EconomyPrincipal, input: CreatePurchaseInput): Promise<CreatePurchaseResultPayload>;
}

// catalog 占位：M16-A/B 不接 content-catalog（见文件头 I 绑定说明）。
const NULL_ECONOMY_CATALOG: EconomyCatalogPort = {
  getOrderTemplate: () => null,
  listOrderTemplates: () => []
};

export class EconomyUseCases {
  readonly orders: OrderService;
  readonly purchases: PurchaseService;
  readonly accept: AcceptOrderUseCase;
  readonly deliver: DeliverOrderUseCase;
  readonly purchase: CreatePurchaseUseCase;

  constructor(db: Db, catalog: EconomyCatalogPort = NULL_ECONOMY_CATALOG) {
    const orderRepo = new OrderRepository(db);
    const purchaseRepo = new PurchaseRepository(db);
    // world 基地行只读参与（账号→基地、基地时钟 FOR UPDATE）；BaseRepository 结构满足
    // economy 侧 EconomyLookupPort / EconomyClockPort 镜像端口，无需适配层。
    const baseRepo = new BaseRepository(db);

    this.orders = new OrderService({
      lookup: baseRepo,
      clock: baseRepo,
      catalog,
      assets: orderRepo,
      store: orderRepo,
      credits: purchaseRepo,
      receipts: (tx) => new AssetMutationService(tx)
    });
    this.purchases = new PurchaseService({
      lookup: baseRepo,
      clock: baseRepo,
      credits: purchaseRepo,
      inventory: purchaseRepo,
      store: purchaseRepo,
      receipts: (tx) => new AssetMutationService(tx)
    });

    this.accept = {
      execute: (principal, input) =>
        db.transaction((tx) => this.orders.acceptOrder(tx, principal, input))
    };
    this.deliver = {
      execute: (principal, input) =>
        db.transaction((tx) => this.orders.deliverOrder(tx, principal, input))
    };
    this.purchase = {
      execute: (principal, input) =>
        db.transaction((tx) => this.purchases.createPurchase(tx, principal, input))
    };
  }
}

export function createEconomyUseCases(db: Db, catalog?: EconomyCatalogPort): EconomyUseCases {
  return new EconomyUseCases(db, catalog);
}
