export const oss = [
  {
    repo: 'hashicorp/terraform-provider-aws',
    note: 'Terraform の公式 AWS Provider',
    url: 'https://github.com/hashicorp/terraform-provider-aws/pulls?q=is%3Apr+author%3Afukubaka0825',
  },
  {
    repo: 'mercari/tfnotify',
    note: 'Terraform の実行結果を通知する CLI',
    url: 'https://github.com/mercari/tfnotify/pulls?q=is%3Apr+author%3Afukubaka0825',
  },
  {
    repo: 'evalphobia/aws-sdk-go-wrapper',
    note: 'AWS SDK for Go のラッパー',
    url: 'https://github.com/evalphobia/aws-sdk-go-wrapper/pulls?q=is%3Apr+author%3Afukubaka0825',
  },
]

export const certifications = [
  { date: '2021-11', name: 'AWS Certified Machine Learning – Specialty' },
  { date: '2019-03', name: 'AWS Certified Solutions Architect – Associate' },
  { date: '2018-11', name: '基本情報技術者' },
  { date: '2018-04', name: 'TOEIC 850' },
  { date: '2016-04', name: '日商簿記3級' },
]

export const education = {
  school: 'Waseda University',
  degree: 'Bachelor of Economics',
  faculty: '政治経済学部',
  graduated: '2018-03',
  url: 'https://www.waseda.jp/fpse/pse/',
}

export const languages = [
  { name: '日本語', level: 'ネイティブ' },
  { name: 'English', level: 'ビジネス（TOEIC 850）' },
]

// Zenn には AI 生成寄りの記事も混ざるので、RSS 全件ではなく載せると決めた記事の slug だけを通す。
export const zennAllowlist = new Set(['1ef743cd9ae17e'])

// Qiita は51件あって他媒体を圧倒するので、載せると決めた記事の URL だけを通す。
export const qiitaPicks = [
  'https://qiita.com/fukubaka0825/items/68506b1e6644404d6cc0',
  'https://qiita.com/fukubaka0825/items/641be849eff3409636c3',
  'https://qiita.com/fukubaka0825/items/6d60990f6f4f643e414c',
  'https://qiita.com/fukubaka0825/items/e331065698fef4fc8a01',
  'https://qiita.com/fukubaka0825/items/979a02a93e1ebcac31f1',
  'https://qiita.com/fukubaka0825/items/53cd168730815a33f51f',
]
