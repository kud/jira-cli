import React, { useState } from "react"
import { Box, Text, useInput } from "ink"

interface TextInputProps {
  label: string
  placeholder?: string
  optional?: boolean
  onSubmit: (value: string) => void
}

export const TextInput = ({
  label,
  placeholder,
  optional,
  onSubmit,
}: TextInputProps) => {
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value)
      return
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((v) => v + input)
    }
  })

  return (
    <Box flexDirection="column" gap={0} paddingY={1}>
      <Box gap={1}>
        <Text bold>{label}</Text>
        {optional && <Text dimColor>(optional — Enter to skip)</Text>}
      </Box>
      <Box gap={0}>
        <Text color="cyan">❯ </Text>
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text dimColor>{placeholder ?? ""}</Text>
        )}
        <Text color="cyan">█</Text>
      </Box>
    </Box>
  )
}
