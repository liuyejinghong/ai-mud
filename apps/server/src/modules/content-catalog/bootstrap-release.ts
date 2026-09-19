// M12-D 引导 release 装载：v0.12 无发布写路径，静态导入内置默认 release 原样返回；
// 内容的发布/激活记录属 M13-P，届时在此扩展为从持久层读取已激活快照。
import { DEFAULT_BASE_CONTENT_RELEASE } from "@ai-mud/content";
import type { ContentBaseRelease } from "@ai-mud/content";

export function loadBootstrapRelease(): ContentBaseRelease {
  return DEFAULT_BASE_CONTENT_RELEASE;
}
