import React from 'react';
import { t } from '../i18n';
export default function MembershipBadge({ membership }) {
  if (!membership) return null;
  return <span className="membership-badge">{membership === 'annual' ? t('年度大会员') : t('大会员')}</span>;
}
