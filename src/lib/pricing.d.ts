import type { TokenUsage, PricingContext } from "./sessionTypes";

export const NANO_AIU_PER_CREDIT: number;
export const USD_PER_CREDIT: number;

export function hasModelPricing(modelName: string | null | undefined): boolean;
export function estimateCostDetails(tokenUsage: TokenUsage | null | undefined, modelName?: string | null, context?: PricingContext): { cost: number | null; notes: string[] };
export function estimateCost(tokenUsage: TokenUsage | null | undefined, modelName?: string | null, context?: PricingContext): number | null;
export function estimateMultiModelCost(modelTokenMap: Record<string, TokenUsage> | null | undefined, context?: PricingContext): number | null;
export function formatCost(usd: number | null | undefined): string;
export function nanoAiuToCredits(nanoAiu: number | null | undefined): number | null;
export function creditsToUsd(credits: number | null | undefined): number;
export function isAiCreditsUnit(unit: string | null | undefined): boolean;
export function formatCredits(value: number | null | undefined): string;
export function formatCreditsWithUsd(value: number | null | undefined): string;
export function formatCostValue(value: number | null | undefined, unit?: string | null): string;
export function formatSessionCost(metadata: { totalCost?: number | null; totalCostUnit?: string | null } | null | undefined): string | null;
export function getSessionCostLabel(metadata: { totalCost?: number | null; totalCostUnit?: string | null } | null | undefined, estimated?: boolean): string;
