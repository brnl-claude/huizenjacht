{{- define "hj.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "hj.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "hj.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hj.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "hj.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "hj.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Name of the PVC for /data. */}}
{{- define "hj.dataClaim" -}}
{{- default (include "hj.fullname" .) .Values.persistence.existingClaim }}
{{- end }}

{{/* Where the app reads reports from, empty when there is no source. */}}
{{- define "hj.reportsDir" -}}
{{- if .Values.reports.git.enabled }}/reports/current
{{- else if .Values.reports.existingClaim }}/reports
{{- end }}
{{- end }}
