import { Redirect } from "expo-router";
import React from "react";

// The former "My Day" schedule screen has been merged into the "My Day"
// (routes) tab. This redirect keeps any old links / router pushes to
// /(tabs)/my-day working by forwarding them to the merged screen.
export default function MyDayRedirect() {
  return <Redirect href="/(tabs)/routes" />;
}
