export const demoReferrals = [
  {
    name: "Alex Morgan",
    initials: "AM",
    wallet: "0x7a2B...8f3D",
    date: "2026-10-16",
    status: "Completed",
    reward: 5,
    color: "lavender",
  },
  {
    name: "Jamie Chen",
    initials: "JC",
    wallet: "0x3c9A...2b7E",
    date: "2026-10-15",
    status: "Completed",
    reward: 5,
    color: "peach",
  },
  {
    name: "Taylor Kim",
    initials: "TK",
    wallet: "0x9e4F...6a1C",
    date: "2026-10-15",
    status: "Pending",
    reward: 0,
    color: "green",
  },
  {
    name: "Sam Wilson",
    initials: "SW",
    wallet: "0x2d6C...9e4A",
    date: "2026-10-14",
    status: "Completed",
    reward: 5,
    color: "blue",
  },
  {
    name: "Jordan Lee",
    initials: "JL",
    wallet: "0x8b1E...3c5F",
    date: "2026-10-13",
    status: "Completed",
    reward: 5,
    color: "pink",
  },
  {
    name: "Riley Park",
    initials: "RP",
    wallet: "0x1f7B...4a2D",
    date: "2026-10-12",
    status: "Pending",
    reward: 0,
    color: "peach",
  },
  {
    name: "Casey Brooks",
    initials: "CB",
    wallet: "0x6d3E...8b9C",
    date: "2026-10-11",
    status: "Completed",
    reward: 5,
    color: "green",
  },
  {
    name: "Drew Miller",
    initials: "DM",
    wallet: "0x4a8C...1e6B",
    date: "2026-10-10",
    status: "Completed",
    reward: 5,
    color: "lavender",
  },
];
export function useReferralDemo() {
  const config = useRuntimeConfig();
  const referralCode = "1";
  const appliedCode = useState("demo-applied-code", () => "");
  const referralLink = computed(
    () =>
      `${config.public.appUrl || (import.meta.client ? window.location.origin : "")}/?ref=${referralCode}`,
  );
  return { referralCode, referralLink, appliedCode };
}
