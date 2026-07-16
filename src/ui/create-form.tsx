import React, { useState } from "react"
import { Box, Text, useApp } from "ink"
import { Select } from "./select.js"
import { TextInput } from "./text-input.js"

export interface CreateFormFields {
  project: string
  summary: string
  type: string
  priority: string
}

type Step = "project" | "summary" | "type" | "priority"

const ISSUE_TYPES = [
  { label: "Story", value: "Story" },
  { label: "Task", value: "Task" },
  { label: "Bug", value: "Bug" },
  { label: "Spike", value: "Spike", hint: "(uses Task type)" },
]

const PRIORITIES = [
  { label: "Highest", value: "Highest" },
  { label: "High", value: "High" },
  { label: "Medium", value: "Medium" },
  { label: "Low", value: "Low" },
  { label: "Lowest", value: "Lowest" },
]

interface CreateFormProps {
  defaults?: Partial<CreateFormFields>
  onSubmit: (fields: CreateFormFields) => void
}

export const CreateForm = ({ defaults = {}, onSubmit }: CreateFormProps) => {
  const { exit } = useApp()
  const [step, setStep] = useState<Step>(
    defaults.project ? "summary" : "project",
  )
  const [fields, setFields] = useState<Partial<CreateFormFields>>(defaults)

  const advance = (next: Partial<CreateFormFields>) => {
    const updated = { ...fields, ...next }
    setFields(updated)

    if (step === "project") setStep("summary")
    else if (step === "summary") setStep("type")
    else if (step === "type") setStep("priority")
    else {
      onSubmit(updated as CreateFormFields)
      exit()
    }
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>New Jira issue</Text>
      {fields.project && step !== "project" && (
        <Text dimColor>Project: {fields.project}</Text>
      )}
      {fields.summary && step !== "summary" && (
        <Text dimColor>Summary: {fields.summary}</Text>
      )}
      {fields.type && step !== "type" && (
        <Text dimColor>Type: {fields.type}</Text>
      )}

      {step === "project" && (
        <TextInput
          label="Project key"
          placeholder="e.g. GO"
          onSubmit={(v) => v && advance({ project: v.toUpperCase() })}
        />
      )}

      {step === "summary" && (
        <TextInput
          label="Summary"
          placeholder="What needs to be done?"
          onSubmit={(v) => v && advance({ summary: v })}
        />
      )}

      {step === "type" && (
        <Select
          label="Issue type"
          options={ISSUE_TYPES}
          onSelect={(v) => advance({ type: v })}
        />
      )}

      {step === "priority" && (
        <Select
          label="Priority"
          options={PRIORITIES}
          onSelect={(v) => advance({ priority: v })}
        />
      )}
    </Box>
  )
}
