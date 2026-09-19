// M15-A 天气服务：确定性循环序列（晴 24h → 预警 2h → 尘暴 6h → 晴…），无随机。
// 序列在 provision 时生成写入 base_weather_schedule；结算按 simTime 查当前段。
// 光照系数：clear 1.0 / warning 0.7 / storm 0.25（积尘由 industry 结算另乘）。
import { and, asc, eq, lte, gt } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { weatherSchedule as baseWeatherSchedule } from "../../db/schema.js";
import type { WeatherType } from "@ai-mud/shared";

export const WEATHER_CYCLE: Array<{ weather: WeatherType; durationSimMs: number }> = [
  { weather: "clear", durationSimMs: 24 * 3_600_000 },
  { weather: "warning", durationSimMs: 2 * 3_600_000 },
  { weather: "storm", durationSimMs: 6 * 3_600_000 }
];

export const WEATHER_LIGHT_FACTOR: Record<WeatherType, number> = {
  clear: 1.0,
  warning: 0.7,
  storm: 0.25
};

// 尘暴积尘增量/晴天下沉降（每模拟小时）。
export const DUST_PER_HOUR_STORM = 8;
export const DUST_PER_HOUR_CLEAR = -1;

export class WeatherService {
  constructor(private readonly db: Db) {}

  // provision 时调用：从 base.simTime 起生成两个完整循环（覆盖首个尘暴 + 平静期）。
  async generateSchedule(tx: WeatherTx, baseId: string, startSim: Date): Promise<void> {
    let cursor = startSim.getTime();
    let seq = 0;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      for (const entry of WEATHER_CYCLE) {
        await tx.insert(baseWeatherSchedule).values({
          baseId,
          seq: seq++,
          weather: entry.weather,
          startSim: new Date(cursor),
          endSim: new Date(cursor + entry.durationSimMs)
        });
        cursor += entry.durationSimMs;
      }
    }
  }

  async current(tx: WeatherTx, baseId: string, simTime: Date): Promise<{
    current: WeatherType;
    lightFactor: number;
    nextChangeAt: Date;
    nextWeather: WeatherType;
  }> {
    const rows = await tx
      .select()
      .from(baseWeatherSchedule)
      .where(and(eq(baseWeatherSchedule.baseId, baseId), lte(baseWeatherSchedule.startSim, simTime), gt(baseWeatherSchedule.endSim, simTime)))
      .orderBy(asc(baseWeatherSchedule.startSim))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return { current: "clear", lightFactor: 1.0, nextChangeAt: simTime, nextWeather: "clear" };
    }
    const next = (await this.nextSegment(tx, baseId, row.seq)) ?? "clear";
    return {
      current: row.weather as WeatherType,
      lightFactor: WEATHER_LIGHT_FACTOR[row.weather as WeatherType] ?? 1.0,
      nextChangeAt: row.endSim,
      nextWeather: next
    };
  }

  private async nextSegment(tx: WeatherTx, baseId: string, seq: number): Promise<WeatherType | null> {
    const rows = await tx
      .select()
      .from(baseWeatherSchedule)
      .where(and(eq(baseWeatherSchedule.baseId, baseId), eq(baseWeatherSchedule.seq, seq + 1)))
      .limit(1);
    return (rows[0]?.weather as WeatherType) ?? null;
  }

  async listSchedule(tx: WeatherTx, baseId: string) {
    return tx
      .select()
      .from(baseWeatherSchedule)
      .where(eq(baseWeatherSchedule.baseId, baseId))
      .orderBy(asc(baseWeatherSchedule.seq));
  }
}

export type WeatherTx = Pick<Db, "insert" | "select" | "update">;
