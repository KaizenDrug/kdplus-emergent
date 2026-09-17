import React from "react";

export default function BrandLogo({ className = "h-10 w-auto", alt = "KDPLUS Pharmacy" }) {
  return <img src="/kdplus-logo.png" alt={alt} className={`object-contain ${className}`} />;
}
