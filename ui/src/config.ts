export const IS_PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === "true";

/**
 * 首页推荐问题（UX-03）。
 *
 * 三个问题分别查找「项目功能与体验」「八股题的前提、机制与边界」
 * 「继承与新增的贡献边界」的原文依据，与公开模式的原文展示保持一致。
 * 点击后直接创建发送意图并发送，不需要先填输入框。
 */
export interface DemoPrompt {
  /** 展示文案，手机首屏用短句。 */
  title: string;
  /** 一行说明这个问题验证什么能力。 */
  description: string;
  /** 实际发送给 Agent 的问题原文。 */
  prompt: string;
}

export const DEMO_PROMPTS: readonly DemoPrompt[] = [
  {
    title: "了解这个项目",
    description: "从资料原文了解核心功能",
    prompt:
      "请检索问档 DocAsk 的产品导览，展示说明核心功能和体验方式的原文依据。",
  },
  {
    title: "试一道有依据的八股题",
    description: "看原文中的前提、机制和边界",
    prompt:
      "为什么 volatile 不能保证 i++ 的原子性？请检索资料，展示包含适用前提和处理办法的原文依据。",
  },
  {
    title: "作者新增了哪些能力",
    description: "区分上游已有与本仓库新增",
    prompt:
      "请检索问档的能力归属资料，展示区分上游继承与本仓库新增能力的原文。",
  },
] as const;

/**
 * 回答之后的相关追问（UX-03 第 7 步：至多两条，选择后才发起新的运行）。
 * 只有点击才会发送，不会随着答案自动提交。
 */
export const FOLLOW_UP_PROMPTS: readonly string[] = [
  "重复点击发送会不会跑两次？",
  "点了取消之后模型又返回了，会发生什么？",
] as const;
