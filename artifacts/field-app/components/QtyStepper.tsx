import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Quantity control with minus / editable numeric field / plus.
 *
 * The middle value is a real text input so users can tap and type an exact
 * quantity (e.g. jumping straight to 250) instead of tapping +/- repeatedly.
 * Typed values commit on blur or submit; an empty/invalid entry reverts to the
 * last good value. Reaching 0 (via minus or typing 0) calls onChange(0), which
 * the parent screens treat as "remove this line", matching the existing
 * minus-to-zero behavior.
 */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  value: number;
  onChange: (qty: number) => void;
  min?: number;
  step?: number;
}) {
  const colors = useColors();
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseFloat(text.replace(",", "."));
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    const next = Math.max(min, parsed);
    onChange(next);
    setText(String(next));
  };

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.btn, { borderColor: colors.border }]}
        onPress={() => onChange(Math.max(min, value - step))}
        hitSlop={6}
      >
        <Feather name="minus" size={14} color={colors.foreground} />
      </Pressable>
      <TextInput
        style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="decimal-pad"
        returnKeyType="done"
        selectTextOnFocus
        textAlign="center"
      />
      <Pressable
        style={[styles.btn, { borderColor: colors.border }]}
        onPress={() => onChange(value + step)}
        hitSlop={6}
      >
        <Feather name="plus" size={14} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minWidth: 48,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
