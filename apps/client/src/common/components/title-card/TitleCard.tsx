import { useTranslation } from '../../../translation/TranslationProvider';

import './TitleCard.scss';

interface TitleCardProps {
  label: string;
  title: string;
  secondary?: string;
}

export default function TitleCard(props: TitleCardProps) {
  const { label, title, secondary } = props;
  const { getLocalizedString } = useTranslation();

  const accent = label === getLocalizedString(`common.now`);

  return (
    <div className='title-card'>
      <div className='inline'>
        <span className='title-card__title'>{title}</span>
        <span className={accent ? 'title-card__label title-card__label--accent' : 'title-card__label'}>{label}</span>
      </div>
      {secondary && <div className='title-card__secondary'>{secondary}</div>}
    </div>
  );
}
