import { Events } from '@dcl/schemas/dist/platform/events'
import { AppComponents, SnsPublisherComponent, SnsPublishError } from '../../types'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { DeployableEntity } from '@dcl/snapshots-fetcher/dist/types'
import { SnsOptions, SnsType } from './types'
import { buildDeploymentMessage } from './utils'

export async function createSnsPublisherComponent(
  components: Pick<AppComponents, 'config' | 'logs'>,
  options: SnsOptions
): Promise<SnsPublisherComponent> {
  const { config, logs } = components

  const endpoint = await config.getString('SNS_ENDPOINT')
  const logger = logs.getLogger('SnsPublisher')

  const client = new SNSClient({
    endpoint: endpoint ?? undefined
  })

  const arnConfigName: Record<SnsType, string> = {
    [SnsType.DEPLOYMENT]: 'SNS_ARN',
    [SnsType.EVENT]: 'EVENTS_SNS_ARN'
  }

  const arn = await config.requireString(arnConfigName[options.type])

  return {
    async publishMessage(entity: DeployableEntity, contentServerUrls: string[]) {
      try {
        const message = buildDeploymentMessage(options.type, entity, contentServerUrls)

        logger.info(`Publishing message of type ${options.type}`, {
          entityId: entity.entityId,
          entityType: entity.entityType
        })

        const receipt = await client.send(
          new PublishCommand({
            TopicArn: arn,
            Message: JSON.stringify(message),
            MessageAttributes: {
              type: { DataType: 'String', StringValue: Events.Type.CATALYST_DEPLOYMENT },
              subType: { DataType: 'String', StringValue: entity.entityType as Events.SubType.CatalystDeployment }
            }
          })
        )

        logger.info(`Notification of type ${options.type} sent`, {
          messageId: receipt.MessageId as any,
          sequenceNumber: receipt.SequenceNumber as any,
          entityId: entity.entityId,
          entityType: entity.entityType
        })
      } catch (error: any) {
        logger.error('Failed to publish message', {
          entityId: entity.entityId,
          entityType: entity.entityType,
          error: error?.message,
          stack: error?.stack
        })
        // TODO: Is this going to change the behavior of the scheduled job?
        throw new SnsPublishError('Failed to publish message', { entity, error })
      }
    }
  }
}
