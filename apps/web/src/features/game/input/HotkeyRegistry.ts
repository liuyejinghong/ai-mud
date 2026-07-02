export type InputContextScope = "global" | "panel" | "modal" | "text-entry";

export interface HotkeyRecord {
  key: string;
  contextScope: InputContextScope;
  action: string;
  description: string;
  handler: () => void;
}

export interface HotkeyDescription {
  key: string;
  contextScope: InputContextScope;
  action: string;
  description: string;
}

export function normalizeHotkeyKey(key: string) {
  return key.toLowerCase();
}

export class HotkeyRegistry {
  private readonly records: HotkeyRecord[] = [];

  register(record: HotkeyRecord) {
    const normalizedRecord = {
      ...record,
      key: normalizeHotkeyKey(record.key)
    };
    this.records.push(normalizedRecord);
    return normalizedRecord;
  }

  find(key: string, contextScope: InputContextScope) {
    const normalizedKey = normalizeHotkeyKey(key);
    return this.records.find(
      (record) => record.key === normalizedKey && record.contextScope === contextScope
    );
  }

  getRecords(): HotkeyDescription[] {
    return this.records.map(({ key, contextScope, action, description }) => ({
      key,
      contextScope,
      action,
      description
    }));
  }
}
