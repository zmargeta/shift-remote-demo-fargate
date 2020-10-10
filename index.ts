import * as eks from "@pulumi/eks"

const cluster = new eks.Cluster("shift-remote-cluster", {
    fargate: true
})

export const kubeconfig = cluster.kubeconfig
