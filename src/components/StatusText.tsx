import React from 'react';
import {
  AlertCircle,
  ArrowRightCircle,
  CheckCircle2,
  Clock,
  PauseCircle,
  Circle,
} from 'lucide-react';

interface StatusTextProps {
  status: string;
}

export const StatusText: React.FC<StatusTextProps> = ({ status }) => {
  switch (status) {
    case 'Completed':
    case 'Submitted':
    case 'Active':
    case 'Approved':
    case 'Sent':
    case 'Accepted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'In Progress':
    case 'Pending':
    case 'Planned':
    case 'Reopened':
    case 'Queued':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Blocked':
    case 'Overdue':
    case 'Failed':
    case 'Inactive':
    case 'Cancelled':
    case 'Revoked':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Carried Forward':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap">
          <ArrowRightCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Deferred':
    case 'Archived':
    case 'Expired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
          <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
          <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
  }
};

export const PriorityText: React.FC<{ priority: string }> = ({ priority }) => {
  const color =
    priority === 'Critical'
      ? 'text-red-700 font-semibold'
      : priority === 'High'
      ? 'text-amber-700 font-semibold'
      : priority === 'Medium'
      ? 'text-slate-700 font-medium'
      : 'text-slate-500 font-normal';

  return <span className={`text-xs whitespace-nowrap ${color}`}>{priority}</span>;
};
