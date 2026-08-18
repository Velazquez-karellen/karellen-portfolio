import { requireChatGPTUser } from "../chatgpt-auth";
import StudioClient from "./StudioClient";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await requireChatGPTUser("/studio");
  return <StudioClient displayName={user.displayName} />;
}
