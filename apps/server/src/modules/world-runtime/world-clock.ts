export interface WorldClock {
  now(): Date;
}

export const systemWorldClock: WorldClock = {
  now: () => new Date()
};
