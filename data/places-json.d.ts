type PlaceRow = {
  id: string;
  name: string;
  province: string;
  island: "luzon" | "visayas" | "mindanao";
  ncr: boolean;
  kind: "city" | "municipality";
  aliases: string[];
};

declare module "@/data/places.json" {
  const value: PlaceRow[];
  export default value;
}

declare module "@/data/places-1.json" {
  const value: PlaceRow[];
  export default value;
}

declare module "@/data/places-2.json" {
  const value: PlaceRow[];
  export default value;
}
