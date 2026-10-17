import { requireUser } from "../../utils/auth";
import { walletFor } from "../../utils/wallet";

export default defineEventHandler((event) => walletFor(requireUser(event).id));
