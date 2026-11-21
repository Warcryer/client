// Names and colours of the nets. Kept free of anything that starts voice, so
// the compact strip can use them too.
import type { NetKind } from "../settings";
import { t } from "../words";

export const NET_TEXT: Record<NetKind, string> = {
  broadcast: "text-net-broadcast",
  command: "text-net-command",
  clan: "text-net-clan",
  party: "text-net-party",
  reserve: "text-net-reserve",
  lounge: "text-text",
  group: "text-net-party",
};

/** In the app's own words; shown through netName(), which says them the alliance's way. t() where shown. */
const NET_NAME: Record<NetKind, string> = {
  broadcast: "Broadcast",
  command: "Command",
  clan: "Clan",
  party: "Party",
  reserve: "Reserve",
  lounge: "Lounge",
  group: "Group",
};

/** A net's name as this alliance says it: "Clan" may read "Guild". */
export const netName = (net: NetKind): string => t(NET_NAME[net]);
