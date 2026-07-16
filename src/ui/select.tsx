import React, { useState } from "react"
import { Box, Text, useApp, useInput } from "ink"

interface SelectOption<T> {
  label: string
  value: T
  hint?: string
}

interface SelectProps<T> {
  options: SelectOption<T>[]
  label?: string
  onSelect: (value: T) => void
}

export const Select = <T,>({ options, label, onSelect }: SelectProps<T>) => {
  const { exit } = useApp()
  const [cursor, setCursor] = useState(0)

  useInput((_, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
    if (key.downArrow) setCursor((c) => Math.min(options.length - 1, c + 1))
    if (key.return) {
      const selected = options[cursor]
      if (selected) {
        onSelect(selected.value)
        exit()
      }
    }
    if (key.escape) exit()
  })

  return (
    <Box flexDirection="column" paddingY={1}>
      {label && (
        <Text dimColor bold>
          {label}
        </Text>
      )}
      {options.map((opt, i) => (
        <Box key={i} gap={1}>
          <Text color={i === cursor ? "cyan" : undefined}>
            {i === cursor ? "❯" : " "}
          </Text>
          <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
            {opt.label}
          </Text>
          {opt.hint && <Text dimColor>{opt.hint}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  )
}
