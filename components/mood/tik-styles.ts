/** Background designs for short text Tiks (the names match the database check). */
export const TIK_STYLES = ["sunset", "ocean", "grape", "forest", "gold", "night", "candy", "fire"] as const;
export type TikStyle = (typeof TIK_STYLES)[number];
/** Designs only suit short posts without a picture. */
export const STYLE_MAX = 160;
export const canStyle = (body: string, hasPic: boolean) => !hasPic && body.trim().length <= STYLE_MAX;
