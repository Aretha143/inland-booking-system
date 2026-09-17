// Public, browser-safe configuration ONLY.
// The Supabase URL and the publishable (anon) key are designed to be public —
// all data access is protected by Row Level Security and Edge Function checks.
// NEVER put service-role keys, Google client secrets or tokens in this file.
export const CONFIG = {
  SUPABASE_URL: "https://wwecnrenodtkxgusdrhr.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Dwxjovm52WeBcecVqnc9Pw__yY5h5aE",

  APP_NAME: "Booking Confirmation System",
  HOTEL_BRAND: "INLAND MULTI CUISINE & STAY",
  HOTEL_LOCATION: "Budhanilkantha, Kathmandu, Nepal",
  // Replace assets/img/logo.svg with the official logo (keep the same file name), or point this elsewhere.
  LOGO_URL: "assets/img/logo.svg",
  TIMEZONE: "Asia/Kathmandu",
  CURRENCY: "NPR",
  PAGE_SIZE: 20,
};
