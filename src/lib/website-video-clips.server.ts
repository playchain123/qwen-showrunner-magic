import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateWebsiteBeatClip, type WebsiteClipResult } from "./website-video-clips";
import type { WebsiteBrandKit, WebsiteVideoBeat } from "./website-video";
import type { WebsiteBeatRenderAsset } from "./website-render-pipeline";

export const generateWebsiteBeatClipServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandKit: z.custom<WebsiteBrandKit>(),
        beat: z.custom<WebsiteVideoBeat>(),
        renderAsset: z.custom<WebsiteBeatRenderAsset>(),
        projectId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WebsiteClipResult> => {
    const request = getRequest();
    const authToken = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
    return generateWebsiteBeatClip({
      brandKit: data.brandKit,
      beat: data.beat,
      renderAsset: data.renderAsset,
      userId: context.userId,
      projectId: data.projectId,
      authToken,
    });
  });
