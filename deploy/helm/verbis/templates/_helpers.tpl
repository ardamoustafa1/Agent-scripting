{{- define "verbis.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "verbis.image" -}}
{{- if .image.digest -}}
{{ .image.repository }}@{{ .image.digest }}
{{- else if .production -}}
{{- fail "production images require immutable image.digest (sha256:...)" -}}
{{- else -}}
{{ .image.repository }}:{{ .image.tag }}
{{- end -}}
{{- end -}}
{{- define "verbis.labels" -}}
app.kubernetes.io/part-of: verbis
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
