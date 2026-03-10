"use client"

import { useEffect, useState } from "react"
import {
LineChart,
Line,
XAxis,
YAxis,
Tooltip,
CartesianGrid,
ResponsiveContainer
} from "recharts"

type Props = {
  projectId?: string
  start?: string
  end?: string
  source?: string
}

export default function DashboardMetricsChart({ projectId, start, end, source = "meta" }: Props){

const [data,setData]=useState<any[]>([])

useEffect(()=>{
  const params = new URLSearchParams()
  if (projectId) params.set("project_id", projectId)
  if (start) params.set("start", start)
  if (end) params.set("end", end)
  if (source) params.set("source", source)
  const qs = params.toString()
  const url = qs ? `/api/dashboard/metrics?${qs}` : "/api/dashboard/metrics"
  fetch(url)
    .then(r=>r.json())
    .then(setData)
},[projectId, start, end, source])

return(

<div style={{height:260}}>

<ResponsiveContainer width="100%" height="100%">
<LineChart data={data}>

<CartesianGrid stroke="rgba(255,255,255,0.05)" />

<XAxis dataKey="day"/>

<YAxis/>

<Tooltip/>

<Line
type="monotone"
dataKey="spend"
stroke="#7c7cff"
strokeWidth={2}
/>

<Line
type="monotone"
dataKey="clicks"
stroke="#00ffa3"
strokeWidth={2}
/>

<Line
type="monotone"
dataKey="purchases"
stroke="#ff7c7c"
strokeWidth={2}
/>

</LineChart>
</ResponsiveContainer>

</div>
)
}