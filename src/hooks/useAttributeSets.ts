import { useState, useEffect } from "react";
import { AttributeSet } from "../types";

const STORAGE_KEY = "qa-analyzer-attribute-sets";

const DEFAULT_SETS = [
  "TestSet", "WarrantySet", "Grocery Single Pack", "Grocery Multi Pack", "H&L-C&D-Cookware",
  "H&L-C&D-Serveware", "H&L-C&D-Bakeware", "H&L-C&D-Containers", "H&L-Outdoor & Accessories",
  "HA-WP&D-Accessories", "HH-CE-Brushes, Mops & Buckets", "HH-LE-Laundary Accessories",
  "HH-HE-Car Accessories", "HH-HE-Plastic Storage and Buckets", "E-HM-Weighing scales",
  "HH-EA-Light & Bulbs", "HH-EA-Plug & Extenstion", "HH-EA-Power tools", "H&L-Luggage",
  "H&L-HF-Living Room", "H&L-HF-Bed Room", "H&L-HF-Sofas & Furnitures", "H&L-HF-Cordless Phones",
  "H&L-HF-Seasonal Decor", "H&B-Eyexpress-Sunglasses", "H&L-HF-Bath Furnishing",
  "H&L-HF-Table Linen & Curtains", "H&L-HF-Mattress", "H&L-HF-Floor Covering", "H&L-Toys",
  "H&L-Toys-E-Bikes", "H&L-Toys-Play Ground & Inflated Games", "H&L-S&F-O&G-Team Sports",
  "H&L-S&F-I&D-Racket Sports", "H&L-S&F-Swimming Pool & Accessories",
  "H&L-S&F-OG-TS-Golf Accessories", "H&L-S&F-OG-TS-Skating", "H&L-S&F-OG-Trampoline",
  "H&L-S&F-OG-Other Games & Accessories", "H&L-S&F-E&F-EM-Home GYM", "H&L-S&F-E&F-EM-Tread Mills",
  "H&L-S&F-E&F-EM-Cross Trainer", "H&L-S&F-E&F-EM-Magnetic Upright Bike",
  "H&L-S&F-E&F-EM-Spinning Bike", "H&L-S&F-E&F-Gym And Workout Equipments",
  "H&L-S&F-E&F-Support Equipments", "H&L-S&F-E&F-Fitness Accessories",
  "H&L-S&F-E&F-Strength Training Equipments", "H&L-S&F-E&F-Bicycle & Accessories",
  "H&L-S&F-E&F-B&A-E-Bikes", "H&L-Baby Accessories", "H&B-Perfumes", "H&B-Make Up",
  "H&B-Skin Care", "H&L-Stationery-Pen & Pencil", "H&L-Stationery-Office Supplies",
  "H&L-Stationery-Art & Craft", "H&L-Stationery-School Stationery", "H&L-Stationery-School Bags",
  "H&L-Stationery-Calculators", "H&L-Stationery-Lunch Box & Water Bottle",
  "H&L-Stationery-General Stationery", "H&L-Books", "Electrics-Kitchen Appliances",
  "Elec-HA-Vacuum Cleaners", "Elec-HA-Vacuum Cleaner Accessories", "Elec-HA-Vacuum Cleaning Liquid",
  "Elec-HA-Robotic Vacuum Cleaner", "Elec-HA-Pressure Washers", "Elec-HA-Sewing Machines",
  "Elec-HA-Irons", "Elec-HA-Garment Steamers", "Elec-HA-Heaters", "Elec-HA-Air Purifiers",
  "Elec-HA-Disinfectant Equipment", "Elec-HA-Air Purifier Filters", "Elec-HA-Water Coolers/Dispensers",
  "Elec-HA-Water Filters & Accessories", "Elec-HA-Fans", "Elec-HA-Insect Killers",
  "Elec-LA-Washing Machines", "Elec-LA-Air Conditioners", "Elec-LA-Dishwashers",
  "Elec-LA-Refrigerators", "Elec-LA-Cooking Ranges", "Elec-LA-Cooker Hoods", "Elec-LA-Cooking Hobs",
  "Combo Offers", "Elec-M&W-Smartphones & Tablets",
  "Elec-M&W-MA-Power Adapters / Chargers & Utility Cables", "Elec-M&W-MA-Mobile Cases & Skins",
  "Elec-M&W-MA-Power Banks", "Elec-M&W-MA-Screen Protectors", "Elec-M&W-MA-Stands & Other Accessories",
  "Elec-M&W-W-Smartwatches & Fitness Trackers", "Elec-M&W-W-Wearable Accessories", "Elec-C&A-Desktops",
  "Elec-C&A-Laptops", "Elec-C&A-T&A-Styllus", "Elec-C&A-PCACC-PC Monitors & Projectors",
  "Elec-C&A-PCACC-PC Keyboards & Mouse", "Elec-C&A-PCACC-PC Headsets & Speakers",
  "Elec-C&A-PCACC-Web camera", "Elec-C&A-PCACC-External Storages", "Elec-C&A-PCACC-USB Hubs",
  "Elec-C&A-PCACC-Memory Card Adapters", "Elec-C&A-PCACC-Laptop Stand & Mouse Pad",
  "Elec-C&A-PCACC-Other PC Accessories", "Elec-ITACC-Printers, Scanners & Accessories",
  "Elec-ITACC-Routers & Wi-Fi Range Extenders", "Elec-ITACC-Smart Devices & Accessories",
  "Elec-ITACC-Softwares", "Elec-ITACC-Other IT Accessories", "Elec-Gaming-Consoles",
  "Elec-Gaming-Titles", "Elec-Gaming-VR Headsets", "Elec-Gaming-GA-Controllers",
  "Elec-Gaming-GA-Gaming Chairs & Desks", "Electronics-e-Gift Cards", "Electronics-TV",
  "Elec-Audio-Soundbars&Speakers", "Elec-Audio-Musical Instruments", "Elec-Audio-Radio",
  "Elec-Audio-Receiver", "Elec-Audio-Headphones", "Elec-Audio-Audio Accessories",
  "Elec-PC-Shavers & Trimmers", "Elec-PC-Epilators & IPL Hair Remover", "Elec-PC-Hair Dryers",
  "Elec-PC-Hair Stylers", "Elec-PC-Electric Toothbrush", "Elec-PC-Other Accessories",
  "Electronic-Camera", "Electronics-Medical Equipment", "Bag Attribute Set", "Lulu Gift Card",
  "Grocery Fish&Meat Multi Pack", "Elec-Gaming-GA-Gaming-Accessories"
];

export function useAttributeSets() {
  const [attributeSets, setAttributeSets] = useState<AttributeSet[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let parsed: AttributeSet[] = stored ? JSON.parse(stored) : [];
      
      const existingNames = new Set(parsed.map(s => s.name));
      const missingDefaults = DEFAULT_SETS.filter(name => !existingNames.has(name)).map((name) => ({
        id: crypto.randomUUID(),
        name,
        rulesMarkdown: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      if (missingDefaults.length > 0) {
        parsed = [...parsed, ...missingDefaults];
      }
      return parsed;
    } catch (error) {
      console.error("Failed to parse attribute sets from local storage", error);
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attributeSets));
  }, [attributeSets]);

  const addSet = (set: Omit<AttributeSet, "id" | "createdAt" | "updatedAt">) => {
    const newSet: AttributeSet = {
      ...set,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setAttributeSets((prev) => [...prev, newSet]);
    return newSet;
  };

  const updateSet = (id: string, updates: Partial<Omit<AttributeSet, "id" | "createdAt" | "updatedAt">>) => {
    setAttributeSets((prev) =>
      prev.map((set) =>
        set.id === id ? { ...set, ...updates, updatedAt: Date.now() } : set
      )
    );
  };

  const deleteSet = (id: string) => {
    setAttributeSets((prev) => prev.filter((set) => set.id !== id));
  };

  return {
    attributeSets,
    addSet,
    updateSet,
    deleteSet,
  };
}
