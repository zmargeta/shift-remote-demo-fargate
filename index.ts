import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'

const vpc = new awsx.ec2.Vpc(
        'shiftRemote-vpc',
        {
            numberOfAvailabilityZones: 2,
            subnets: [
                {
                    type: 'public',
                    tags: {
                        'kubernetes.io/role/elb': '1'
                    }
                },
                {
                    type: 'private',
                    tags: {
                        'kubernetes.io/role/internal-elb': '1'
                    }
                }
            ]
        }
)

const cluster = new eks.Cluster(
        'shiftRemote-cluster',
        {
            vpcId: vpc.id,
            publicSubnetIds: vpc.publicSubnetIds,
            privateSubnetIds: vpc.privateSubnetIds,
            createOidcProvider: true,
            fargate: true
        }
)

// noinspection JSUnusedGlobalSymbols
export const kubeconfig = cluster.kubeconfig

const albIngressServiceAccountName = 'aws-alb-ingress-controller'
const albIngressServiceAccountNamespace = 'kube-system'
const clusterOidcProvider = cluster.core.oidcProvider

const albIngressPolicyDocument: aws.iam.PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
        {
            Effect: 'Allow',
            Action: [
                'acm:DescribeCertificate',
                'acm:ListCertificates',
                'acm:GetCertificate'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'ec2:AuthorizeSecurityGroupIngress',
                'ec2:CreateSecurityGroup',
                'ec2:CreateTags',
                'ec2:DeleteTags',
                'ec2:DeleteSecurityGroup',
                'ec2:DescribeAccountAttributes',
                'ec2:DescribeAddresses',
                'ec2:DescribeInstances',
                'ec2:DescribeInstanceStatus',
                'ec2:DescribeInternetGateways',
                'ec2:DescribeNetworkInterfaces',
                'ec2:DescribeSecurityGroups',
                'ec2:DescribeSubnets',
                'ec2:DescribeTags',
                'ec2:DescribeVpcs',
                'ec2:ModifyInstanceAttribute',
                'ec2:ModifyNetworkInterfaceAttribute',
                'ec2:RevokeSecurityGroupIngress'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'elasticloadbalancing:AddListenerCertificates',
                'elasticloadbalancing:AddTags',
                'elasticloadbalancing:CreateListener',
                'elasticloadbalancing:CreateLoadBalancer',
                'elasticloadbalancing:CreateRule',
                'elasticloadbalancing:CreateTargetGroup',
                'elasticloadbalancing:DeleteListener',
                'elasticloadbalancing:DeleteLoadBalancer',
                'elasticloadbalancing:DeleteRule',
                'elasticloadbalancing:DeleteTargetGroup',
                'elasticloadbalancing:DeregisterTargets',
                'elasticloadbalancing:DescribeListenerCertificates',
                'elasticloadbalancing:DescribeListeners',
                'elasticloadbalancing:DescribeLoadBalancers',
                'elasticloadbalancing:DescribeLoadBalancerAttributes',
                'elasticloadbalancing:DescribeRules',
                'elasticloadbalancing:DescribeSSLPolicies',
                'elasticloadbalancing:DescribeTags',
                'elasticloadbalancing:DescribeTargetGroups',
                'elasticloadbalancing:DescribeTargetGroupAttributes',
                'elasticloadbalancing:DescribeTargetHealth',
                'elasticloadbalancing:ModifyListener',
                'elasticloadbalancing:ModifyLoadBalancerAttributes',
                'elasticloadbalancing:ModifyRule',
                'elasticloadbalancing:ModifyTargetGroup',
                'elasticloadbalancing:ModifyTargetGroupAttributes',
                'elasticloadbalancing:RegisterTargets',
                'elasticloadbalancing:RemoveListenerCertificates',
                'elasticloadbalancing:RemoveTags',
                'elasticloadbalancing:SetIpAddressType',
                'elasticloadbalancing:SetSecurityGroups',
                'elasticloadbalancing:SetSubnets',
                'elasticloadbalancing:SetWebAcl'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'iam:CreateServiceLinkedRole',
                'iam:GetServerCertificate',
                'iam:ListServerCertificates'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'cognito-idp:DescribeUserPoolClient'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'waf-regional:GetWebACLForResource',
                'waf-regional:GetWebACL',
                'waf-regional:AssociateWebACL',
                'waf-regional:DisassociateWebACL'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'tag:GetResources',
                'tag:TagResources'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'waf:GetWebACL'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'wafv2:GetWebACL',
                'wafv2:GetWebACLForResource',
                'wafv2:AssociateWebACL',
                'wafv2:DisassociateWebACL'
            ],
            Resource: '*'
        },
        {
            Effect: 'Allow',
            Action: [
                'shield:DescribeProtection',
                'shield:GetSubscriptionState',
                'shield:DeleteProtection',
                'shield:CreateProtection',
                'shield:DescribeSubscription',
                'shield:ListProtections'
            ],
            Resource: '*'
        }
    ]
}

const albIngressPolicy = new aws.iam.Policy(
        'shiftRemote-albIngressPolicy',
        {
            policy: albIngressPolicyDocument
        }
)

const albIngressServiceAccountAssumeRoleWithWebIdentityPolicy = pulumi.all([clusterOidcProvider?.url, clusterOidcProvider?.arn])
        .apply(([url, arn]) =>
                aws.iam.getPolicyDocument({
                    statements: [
                        {
                            actions: ['sts:AssumeRoleWithWebIdentity'],
                            conditions: [
                                {
                                    test: 'StringEquals',
                                    values: [`system:serviceaccount:${albIngressServiceAccountNamespace}:${albIngressServiceAccountName}`],
                                    variable: `${url.replace('https://', '')}:sub`,
                                },
                            ],
                            effect: 'Allow',
                            principals: [{
                                identifiers: [arn],
                                type: 'Federated'
                            }],
                        },
                    ],
                })
        )

const albIngressServiceAccountRole = new aws.iam.Role(
        'shiftRemote-albIngressServiceAccountRole',
        {
            assumeRolePolicy: albIngressServiceAccountAssumeRoleWithWebIdentityPolicy.json,
        }
)

// noinspection JSUnusedLocalSymbols
const albIngressServiceAccountRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
        'shiftRemote-albIngressServiceRolePolicyAttachment',
        {
            role: albIngressServiceAccountRole,
            policyArn: albIngressPolicy.arn
        }
)

const k8sProvider = new k8s.Provider(
        'k8s',
        {
            kubeconfig: cluster.kubeconfig.apply(JSON.stringify),
        }
)

// noinspection JSUnusedLocalSymbols
const albIngressServiceAccount = new k8s.core.v1.ServiceAccount(
        albIngressServiceAccountName,
        {
            metadata: {
                namespace: albIngressServiceAccountNamespace,
                name: albIngressServiceAccountName,
                annotations: {
                    'eks.amazonaws.com/role-arn': albIngressServiceAccountRole.arn,
                },
            },
        },
        {provider: k8sProvider}
)

// noinspection JSUnusedLocalSymbols
const albIngressController = new k8s.helm.v3.Chart(
        'aws-alb-ingress-controller',
        {
            chart: 'aws-alb-ingress-controller',
            version: '1.0.2',
            namespace: 'kube-system',
            fetchOpts: {
                repo: 'http://storage.googleapis.com/kubernetes-charts-incubator'
            },
            values: {
                clusterName: cluster.eksCluster.name,
                awsRegion: pulumi.output(aws.getRegion({}, {async: true})).apply(it => it.name),
                awsVpcID: vpc.id,
                rbac: {
                    serviceAccount: {
                        create: false,
                        name: albIngressServiceAccountName
                    }
                },
                extraArgs: {
                    'aws-api-debug': true,
                    'v': 5
                },
                image: {
                    tag: 'v1.1.6'
                }
            }
        },
        {provider: cluster.provider}
)

const appName = 'shift-remote-demo-spring'
// noinspection JSUnusedLocalSymbols
const deployment = new k8s.apps.v1.Deployment(
        `${appName}-dep`,
        {
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        app: appName
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            app: appName
                        }
                    },
                    spec: {
                        containers: [
                            {
                                name: appName,
                                image: `zmargeta/${appName}:latest`,
                                ports: [
                                    {
                                        name: 'http',
                                        containerPort: 8080
                                    }
                                ],
                                resources: {
                                    limits: {
                                        cpu: '1',
                                        memory: '1Gi'
                                    },
                                    requests: {
                                        cpu: '1',
                                        memory: '1Gi'
                                    }
                                },
                                livenessProbe: {
                                    httpGet: {
                                        path: '/system/health',
                                        port: 'http'
                                    },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 5,
                                    failureThreshold: 3,
                                    timeoutSeconds: 3
                                },
                                startupProbe: {
                                    httpGet: {
                                        path: '/system/health',
                                        port: 'http'
                                    },
                                    failureThreshold: 6,
                                    periodSeconds: 10
                                },
                                readinessProbe: {
                                    httpGet: {
                                        path: '/system/health',
                                        port: 'http'
                                    },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 5,
                                    failureThreshold: 3,
                                    timeoutSeconds: 3
                                }
                            }]
                    }
                }
            }
        },
        {provider: cluster.provider}
)

const service = new k8s.core.v1.Service(
        `${appName}-svc`,
        {
            spec: {
                type: 'NodePort',
                ports: [
                    {
                        name: 'http',
                        port: 8080,
                        targetPort: 'http'
                    }
                ],
                selector: {
                    app: appName
                }
            }
        },
        {provider: cluster.provider}
)

// noinspection JSDeprecatedSymbols
const serviceIngress = new k8s.extensions.v1beta1.Ingress(
        'default-ingress',
        {
            metadata: {
                annotations: {
                    'kubernetes.io/ingress.class': 'alb',
                    'alb.ingress.kubernetes.io/scheme': 'internet-facing',
                    'alb.ingress.kubernetes.io/healthcheck-path': '/system/health',
                    'alb.ingress.kubernetes.io/target-type': 'ip'
                },
                labels: {
                    app: 'default-ingress'
                }
            },
            spec: {
                rules: [{
                    http: {
                        paths: [{
                            path: '/*',
                            backend: {
                                serviceName: service.metadata.name,
                                servicePort: 'http'
                            }
                        }]
                    }
                }]
            }
        },
        {provider: cluster.provider}
)

// noinspection JSUnusedGlobalSymbols
export const url = serviceIngress.status.loadBalancer.ingress[0].hostname
