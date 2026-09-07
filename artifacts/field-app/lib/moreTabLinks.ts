export type MoreTabName = "loads" | "map" | "orders" | "inbox";

export type MoreTabLink = {
  name: MoreTabName;
  label: string;
  icon: "truck" | "map-pin" | "clipboard" | "message-square";
  href: `/more/${MoreTabName}`;
};

const MORE_TAB_LINKS: readonly MoreTabLink[] = [
  { name: "inbox", label: "Inbox", icon: "message-square", href: "/more/inbox" },
  { name: "loads", label: "Loads", icon: "truck", href: "/more/loads" },
  { name: "map", label: "Map", icon: "map-pin", href: "/more/map" },
  { name: "orders", label: "Orders", icon: "clipboard", href: "/more/orders" },
];

export function getVisibleMoreTabLinks(
  canSeeTab: (name: string) => boolean,
): MoreTabLink[] {
  return MORE_TAB_LINKS.filter((link) => canSeeTab(link.name));
}