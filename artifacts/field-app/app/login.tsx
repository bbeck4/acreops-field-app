import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

export default function LoginScreen() {
  const { ticket } = useLocalSearchParams<{ ticket?: string | string[] }>();
  const signInPath =
    typeof ticket === "string" && ticket.length > 0
      ? `/(auth)/sign-in?ticket=${encodeURIComponent(ticket)}`
      : "/(auth)/sign-in";

  return <Redirect href={signInPath as Href} />;
}
